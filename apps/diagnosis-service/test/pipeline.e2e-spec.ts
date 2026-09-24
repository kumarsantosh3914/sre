import { randomBytes, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AuditLog,
  CitationFailure,
  Diagnosis,
  Incident,
  Integration,
  MonitoredService,
  Tenant,
} from '@sreai/database';
import { createTestDatabase, TestDatabase } from '@sreai/database/testing';
import { QueueUrls, SqsPublisher, drainJsonMessages } from '@sreai/queue';
import { QUEUE_URLS, QueueInfraModule, SQS_CLIENT } from '@sreai/queue/nest';
import {
  ActionCommand,
  AlertMessage,
  AlertSource,
  AlertStatus,
  IncidentSeverity,
  IncidentStatus,
  IntegrationType,
  NormalizedAlert,
  computeAlertFingerprint,
  encryptJson,
} from '@sreai/shared';
import { DataSource } from 'typeorm';
import { DiagnosisModule } from '../src/diagnosis/diagnosis.module';
import { IntakeModule } from '../src/intake/intake.module';
import { ChatRequest, MockUpstreams } from './mock-upstreams';

const ENCRYPTION_KEY = 'b'.repeat(64);
const key = Buffer.from(ENCRYPTION_KEY, 'hex');

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 30_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Pulls the verbatim text of line `[L<n>] ...` out of the prompt the model
// received — what a well-behaved model would quote.
function quoteLine(req: ChatRequest, label: string): string {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const line = user.split('\n').find((l) => l.startsWith(`[${label}] `));
  if (!line) throw new Error(`No ${label} line in prompt`);
  return line.slice(label.length + 3);
}

describe('Diagnosis pipeline (e2e: Postgres + Redis + BullMQ + SQS + mock upstreams)', () => {
  const upstreams = new MockUpstreams();
  let db: TestDatabase;
  let ds: DataSource;
  let app: INestApplication;
  let sqs: SQSClient;
  let urls: QueueUrls;
  let publisher: SqsPublisher;
  let tenantId: string;

  beforeAll(async () => {
    await upstreams.start();
    upstreams.logLines = [
      '{"level":"info","msg":"request served in 42ms"}',
      '{"level":"error","msg":"redis: connection pool exhausted (max=10)"}',
      '{"level":"error","msg":"request failed: timeout acquiring connection"}',
    ];

    Object.assign(process.env, {
      LOCALSTACK_ENDPOINT: process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:4566',
      SQS_QUEUE_NAME_PREFIX: `e2e-${randomBytes(4).toString('hex')}-`,
      BULLMQ_PREFIX: `e2e-${randomBytes(4).toString('hex')}`,
      ENCRYPTION_KEY,
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: `${upstreams.url}/v1`,
      ALLOW_PRIVATE_NETWORK_TARGETS: 'true',
    });

    db = await createTestDatabase();
    ds = new DataSource(db.options);
    await ds.initialize();

    const tenant = await ds
      .getRepository(Tenant)
      .save({ name: 'Acme', slug: 'acme', settings: {} });
    tenantId = tenant.id;
    await ds.getRepository(MonitoredService).save({
      tenantId,
      name: 'auth-service',
      metadata: {
        owner: '@platform',
        dependencies: [{ name: 'payments-service', healthUrl: `${upstreams.url}/health/payments` }],
      },
    });
    await ds.getRepository(Integration).save([
      {
        tenantId,
        type: IntegrationType.LOKI,
        config: { url: upstreams.url },
        encryptedCredentials: encryptJson({}, key),
      },
      {
        tenantId,
        type: IntegrationType.PROMETHEUS,
        config: { url: upstreams.url },
        encryptedCredentials: encryptJson({}, key),
      },
    ]);

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot(db.options),
        QueueInfraModule,
        DiagnosisModule,
        IntakeModule,
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.enableShutdownHooks();
    await app.init();

    sqs = app.get(SQS_CLIENT);
    urls = app.get(QUEUE_URLS);
    publisher = app.get(SqsPublisher);
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
    await db?.destroy();
    await upstreams.stop();
  });

  function alert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
    const title = overrides.title ?? 'HighCPU';
    return {
      alertId: randomUUID(),
      tenantId,
      source: AlertSource.PROMETHEUS,
      status: AlertStatus.FIRING,
      serviceName: 'auth-service',
      severity: IncidentSeverity.P1,
      title,
      description: 'CPU > 90% for 5 minutes',
      labels: { alertname: title, service: 'auth-service' },
      firedAt: new Date().toISOString(),
      resolvedAt: null,
      fingerprint: computeAlertFingerprint(tenantId, 'auth-service', title),
      stormKey: null,
      isStormSummary: false,
      rawPayload: {},
      ...overrides,
    };
  }

  async function send(a: NormalizedAlert, queue: 'p1' | 'p2' = 'p1'): Promise<void> {
    const message: AlertMessage = { kind: 'alert', traceId: `trace-${randomUUID()}`, alert: a };
    await publisher.sendJson(urls[queue], message);
  }

  async function incidentByTitle(title: string, status?: IncidentStatus): Promise<Incident | null> {
    return ds
      .getRepository(Incident)
      .findOne({ where: { tenantId, title, ...(status ? { status } : {}) } });
  }

  it('turns an alert into a grounded, cited, high-confidence diagnosis and hands it to the action layer', async () => {
    upstreams.chatHandler = (req) => ({
      hypothesis: `Redis connection pool exhaustion is starving requests [SOURCE: logs, ${quoteLine(req, 'L2')}].`,
      confidence: 0.9,
      evidence: [
        { claim: 'The Redis pool is exhausted', source: 'logs', reference: quoteLine(req, 'L2') },
        {
          claim: 'Requests time out waiting for a connection',
          source: 'logs',
          reference: quoteLine(req, 'L3'),
        },
        {
          claim: 'Payments dependency is down',
          source: 'dependency',
          reference: quoteLine(req, 'H1'),
        },
      ],
      recommended_action: 'RESTART_SERVICE: restart auth-service to reset the pool',
      action_tier: 'auto',
      reasoning: 'Pool exhaustion errors precede the timeouts.',
    });

    await send(alert());
    const incident = await waitFor(() => incidentByTitle('HighCPU', IncidentStatus.ACTING));

    const diagnosis = await ds
      .getRepository(Diagnosis)
      .findOneOrFail({ where: { tenantId, incidentId: incident.id } });
    expect(diagnosis.citationsPassed).toBe(true);
    expect(diagnosis.citationFailureRate).toBe(0);
    expect(diagnosis.llmConfidence).toBe(0.9);
    expect(diagnosis.confidence).toBeGreaterThanOrEqual(0.85);
    expect(diagnosis.promptVersion).toBe('diagnosis-v1');
    expect(diagnosis.model).toBe('gpt-4o-2024-08-06');

    // The model saw real, labelled, sanitised context from every collector.
    const prompt = upstreams.chatRequests[0].messages[1].content;
    expect(prompt).toContain('ERROR redis: connection pool exhausted (max=10)');
    expect(prompt).toContain('payments-service: unhealthy (HTTP 503');
    expect(prompt).toMatch(/cpu_cores: peak 0\.94/);
    expect(prompt).toContain('<<<DEPLOY source="deploy" status="not_configured">>>');

    const events = await ds.getRepository(AuditLog).find({
      where: { tenantId, incidentId: incident.id },
      order: { createdAt: 'ASC' },
    });
    expect(events.map((e) => e.event)).toEqual([
      'incident.created',
      'incident.status_changed',
      'diagnosis.completed',
    ]);

    const commands = await drainJsonMessages<ActionCommand>(sqs, urls.actions);
    const mine = commands.filter((c) => c.incidentId === incident.id).map((c) => c.kind);
    expect(mine).toEqual(expect.arrayContaining(['incident_opened', 'diagnosis_completed']));
  });

  it('caps confidence and escalates when the model cites things that are not in the context', async () => {
    upstreams.chatHandler = () => ({
      hypothesis: 'The database ran out of disk space after a nightly backup.',
      confidence: 0.97,
      evidence: [
        { claim: 'Disk is full', source: 'logs', reference: 'No space left on device' },
        { claim: 'Backup ran', source: 'deploy', reference: 'nightly backup job started at 03:00' },
      ],
      recommended_action: 'FLUSH_CACHE: free up space',
      action_tier: 'auto',
      reasoning: 'Classic disk exhaustion.',
    });

    await send(alert({ title: 'DiskAlarm' }));
    const incident = await waitFor(() => incidentByTitle('DiskAlarm', IncidentStatus.ACTING));
    const diagnosis = await ds
      .getRepository(Diagnosis)
      .findOneOrFail({ where: { tenantId, incidentId: incident.id } });

    expect(diagnosis.citationsPassed).toBe(false);
    expect(diagnosis.confidence).toBeLessThanOrEqual(0.35);
    expect(diagnosis.actionTier).toBe('escalate');

    const failures = await ds
      .getRepository(CitationFailure)
      .find({ where: { tenantId, diagnosisId: diagnosis.id } });
    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.failureReason)).toEqual(['not_found', 'not_found']);
  });

  it('attaches repeat alerts to the open incident instead of opening a new one', async () => {
    const incident = await waitFor(() => incidentByTitle('HighCPU'));
    await send(alert({ alertId: randomUUID() }));
    await waitFor(async () => {
      const row = await ds
        .getRepository(Incident)
        .findOneOrFail({ where: { tenantId, id: incident.id } });
      return row.alertCount === 2 ? row : null;
    });
    expect(await ds.getRepository(Incident).count({ where: { tenantId, title: 'HighCPU' } })).toBe(
      1,
    );
  });

  it('resolves the incident when the alert clears and computes MTTR', async () => {
    const incident = await waitFor(() => incidentByTitle('HighCPU'));
    const resolvedAt = new Date(incident.detectedAt.getTime() + 240_000);
    await send(alert({ status: AlertStatus.RESOLVED, resolvedAt: resolvedAt.toISOString() }), 'p2');

    const resolved = await waitFor(() => incidentByTitle('HighCPU', IncidentStatus.RESOLVED));
    expect(resolved.mttrSeconds).toBe(240);
    const commands = await drainJsonMessages<ActionCommand>(sqs, urls.actions);
    expect(
      commands.some((c) => c.kind === 'incident_resolved' && c.incidentId === incident.id),
    ).toBe(true);
  });

  it('uses the resolved incident as institutional memory for the next occurrence', async () => {
    let sawSimilar = false;
    upstreams.chatHandler = (req) => {
      const prompt = req.messages[1].content;
      sawSimilar = prompt.includes('[S1] past incident');
      return {
        hypothesis: 'Recurrence of the Redis pool exhaustion seen previously.',
        confidence: 0.7,
        evidence: [
          { claim: 'Pool exhausted again', source: 'logs', reference: quoteLine(req, 'L2') },
        ],
        recommended_action: 'RESTART_SERVICE: restart auth-service',
        action_tier: 'draft',
        reasoning: 'Same signature as a resolved incident.',
      };
    };
    await send(alert());
    const incident = await waitFor(() => incidentByTitle('HighCPU', IncidentStatus.ACTING));
    const diagnosis = await ds
      .getRepository(Diagnosis)
      .findOneOrFail({ where: { tenantId, incidentId: incident.id } });
    expect(sawSimilar).toBe(true);
    expect(diagnosis.similarIncidentIds).toHaveLength(1);
    // +0.05 similar-incident boost on top of the model's 0.7.
    expect(diagnosis.confidence).toBeCloseTo(0.75, 3);
  });

  it('groups an alert storm into one P1 incident and folds in the incidents it just opened', async () => {
    upstreams.chatHandler = (req) => ({
      hypothesis: 'Cascading failures across the checkout service.',
      confidence: 0.5,
      evidence: [{ claim: 'Errors in logs', source: 'logs', reference: quoteLine(req, 'L2') }],
      recommended_action: 'INVESTIGATE: page the owner',
      action_tier: 'escalate',
      reasoning: 'Too many simultaneous alerts to pin down.',
    });
    const svc = 'checkout';
    for (const title of ['CheckoutErrorsA', 'CheckoutErrorsB']) {
      await send(
        alert({
          title,
          serviceName: svc,
          severity: IncidentSeverity.P2,
          fingerprint: computeAlertFingerprint(tenantId, svc, title),
        }),
        'p2',
      );
    }
    await waitFor(async () =>
      (await ds.getRepository(Incident).count({ where: { tenantId, title: 'CheckoutErrorsB' } }))
        ? true
        : null,
    );
    await waitFor(async () =>
      (await ds.getRepository(Incident).count({ where: { tenantId, title: 'CheckoutErrorsA' } }))
        ? true
        : null,
    );

    const stormKey = `storm-${randomUUID()}`;
    await send(
      alert({
        title: 'Alert storm on checkout',
        serviceName: svc,
        isStormSummary: true,
        stormKey,
        fingerprint: computeAlertFingerprint(tenantId, svc, 'Alert storm on checkout'),
      }),
    );
    for (let i = 0; i < 3; i += 1) {
      await send(
        alert({
          title: `CheckoutErrors${i}`,
          serviceName: svc,
          stormKey,
          fingerprint: computeAlertFingerprint(tenantId, svc, `CheckoutErrors${i}`),
        }),
      );
    }

    const storm = await waitFor(async () => {
      const row = await ds
        .getRepository(Incident)
        .findOne({ where: { tenantId, ingestKey: stormKey } });
      return row && row.alertCount >= 4 ? row : null;
    });
    expect(storm.severity).toBe('p1');
    const children = await ds
      .getRepository(Incident)
      .find({ where: { tenantId, parentIncidentId: storm.id } });
    expect(children.map((c) => c.title).sort()).toEqual(['CheckoutErrorsA', 'CheckoutErrorsB']);
  });
});
