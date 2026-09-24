import { randomBytes, randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { IncomingMessage, Server, ServerResponse, createServer } from 'http';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DescribeServicesCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import {
  Action,
  AuditLog,
  Diagnosis,
  Incident,
  Integration,
  MonitoredService,
  Tenant,
} from '@sreai/database';
import { createTestDatabase, TestDatabase } from '@sreai/database/testing';
import { QueueInfraModule } from '@sreai/queue/nest';
import {
  ActionStatus,
  ActionTier,
  ActionType,
  IncidentSeverity,
  IncidentStatus,
  IntegrationType,
  encryptJson,
} from '@sreai/shared';
import { DataSource } from 'typeorm';
import { ActionsModule } from '../src/actions.module';
import { DigestScheduler } from '../src/digest/digest.scheduler';
import { ECS_CLIENT_BUILDER } from '../src/handlers/ecs-client.factory';
import { ActionExecutor } from '../src/orchestrator/action-executor.service';
import { ActionOrchestrator } from '../src/orchestrator/action-orchestrator.service';

const ENCRYPTION_KEY = 'c'.repeat(64);
const key = Buffer.from(ENCRYPTION_KEY, 'hex');

interface Recorded {
  path: string;
  body: Record<string, unknown>;
}

// Slack Web API + PagerDuty Events API stand-in.
class MockNotifications {
  server: Server;
  url = '';
  calls: Recorded[] = [];
  private ts = 1000;

  constructor() {
    this.server = createServer((req, res) => void this.route(req, res));
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  of(path: string): Recorded[] {
    return this.calls.filter((c) => c.path === path);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    this.calls.push({ path: req.url ?? '', body });
    if (req.url === '/pagerduty') {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
      return;
    }
    this.ts += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, channel: body.channel, ts: `${this.ts}.0001` }));
  }
}

// In-memory ECS: one service whose desired count the handlers change.
const ecsState = { desiredCount: 2, forced: 0 };
const fakeEcsBuilder = () => ({
  send: async (command: unknown) => {
    if (command instanceof DescribeServicesCommand) {
      return {
        services: [{ status: 'ACTIVE', desiredCount: ecsState.desiredCount, deployments: [] }],
      };
    }
    if (command instanceof UpdateServiceCommand) {
      if (command.input.desiredCount !== undefined)
        ecsState.desiredCount = command.input.desiredCount;
      if (command.input.forceNewDeployment) ecsState.forced += 1;
      return { service: { desiredCount: ecsState.desiredCount, deployments: [] } };
    }
    throw new Error('unexpected ECS command');
  },
});

describe('Action layer (e2e: Postgres + Redis/BullMQ + mock Slack/PagerDuty/ECS)', () => {
  const mocks = new MockNotifications();
  let db: TestDatabase;
  let ds: DataSource;
  let app: INestApplication;
  let orchestrator: ActionOrchestrator;
  let executor: ActionExecutor;
  let tenantId: string;
  let service: MonitoredService;

  beforeAll(async () => {
    await mocks.start();
    Object.assign(process.env, {
      LOCALSTACK_ENDPOINT: process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:4566',
      SQS_QUEUE_NAME_PREFIX: `e2e-${randomBytes(4).toString('hex')}-`,
      BULLMQ_PREFIX: `e2e-${randomBytes(4).toString('hex')}`,
      CONSUMERS_ENABLED: 'false',
      ENCRYPTION_KEY,
      SLACK_API_URL: mocks.url,
      PAGERDUTY_EVENTS_URL: `${mocks.url}/pagerduty`,
      DASHBOARD_URL: 'https://app.sre.ai',
    });

    db = await createTestDatabase();
    ds = new DataSource(db.options);
    await ds.initialize();

    const tenant = await ds
      .getRepository(Tenant)
      .save({ name: 'Acme', slug: 'acme', settings: {} });
    tenantId = tenant.id;
    service = await ds.getRepository(MonitoredService).save({
      tenantId,
      name: 'auth-service',
      autoExecuteEnabled: true,
      metadata: { ecs: { cluster: 'prod', service: 'auth', maxTasks: 4 }, owner: '@platform' },
    });
    await ds.getRepository(Integration).save([
      {
        tenantId,
        type: IntegrationType.AWS,
        config: { region: 'ap-south-1' },
        encryptedCredentials: encryptJson({ accessKeyId: 'AKIA', secretAccessKey: 's' }, key),
      },
      {
        tenantId,
        type: IntegrationType.SLACK,
        config: { channel: '#incidents' },
        encryptedCredentials: encryptJson({ botToken: 'xoxb-test' }, key),
      },
      {
        tenantId,
        type: IntegrationType.PAGERDUTY,
        config: {},
        encryptedCredentials: encryptJson({ routingKey: 'rk-123' }, key),
      },
    ]);

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot(db.options),
        QueueInfraModule,
        ActionsModule,
      ],
    })
      .overrideProvider(ECS_CLIENT_BUILDER)
      .useValue(fakeEcsBuilder)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    orchestrator = app.get(ActionOrchestrator);
    executor = app.get(ActionExecutor);
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
    await db?.destroy();
    await mocks.stop();
  });

  beforeEach(() => {
    mocks.calls = [];
  });

  async function incidentWithDiagnosis(
    confidence: number,
    recommendedAction: string,
    opts: { svc?: MonitoredService; actionTier?: ActionTier; severity?: IncidentSeverity } = {},
  ): Promise<{ incident: Incident; diagnosis: Diagnosis }> {
    const svc = opts.svc ?? service;
    const incident = await ds.getRepository(Incident).save({
      tenantId,
      serviceId: svc.id,
      severity: opts.severity ?? IncidentSeverity.P2,
      status: IncidentStatus.ACTING,
      title: `HighCPU ${randomUUID().slice(0, 6)}`,
      sourceAlert: {},
      detectedAt: new Date(),
      fingerprint: randomBytes(32).toString('hex'),
    });
    const diagnosis = await ds.getRepository(Diagnosis).save({
      tenantId,
      incidentId: incident.id,
      hypothesis: 'CPU saturation from a traffic spike; the service is at capacity.',
      confidence,
      llmConfidence: confidence,
      evidence: [{ claim: 'CPU peaked', source: 'metrics', reference: 'cpu_cores: peak 0.94' }],
      recommendedAction,
      actionTier: opts.actionTier ?? ActionTier.AUTO,
      reasoning: 'CPU peaked with request rate.',
      citationsPassed: true,
      contextUsed: { recentDeploy: null },
    });
    return { incident, diagnosis };
  }

  function command(incident: Incident, diagnosis: Diagnosis) {
    return {
      kind: 'diagnosis_completed' as const,
      traceId: `t-${randomUUID()}`,
      tenantId,
      incidentId: incident.id,
      diagnosisId: diagnosis.id,
    };
  }

  const actionsOf = (incidentId: string) =>
    ds.getRepository(Action).find({ where: { tenantId, incidentId }, order: { createdAt: 'ASC' } });
  const incidentStatus = async (id: string) =>
    (await ds.getRepository(Incident).findOneByOrFail({ tenantId, id })).status;

  it('high confidence → auto-executes, logs it, and offers rollback in Slack', async () => {
    ecsState.desiredCount = 2;
    const { incident, diagnosis } = await incidentWithDiagnosis(
      0.92,
      'SCALE_SERVICE: add one task',
    );
    await orchestrator.handle(command(incident, diagnosis));

    const [action] = await actionsOf(incident.id);
    expect(action).toMatchObject({ tier: 'auto', status: 'executed', actionType: 'scale_service' });
    expect(action.result).toEqual({ previousDesiredCount: 2, newDesiredCount: 3 });
    expect(ecsState.desiredCount).toBe(3);

    const slack = JSON.stringify(mocks.of('/chat.postMessage'));
    expect(slack).toContain('Auto-executed');
    expect(slack).toContain('sreai_rollback');
    expect(mocks.of('/pagerduty')).toHaveLength(0);

    const audit = await ds
      .getRepository(AuditLog)
      .find({ where: { tenantId, incidentId: incident.id } });
    expect(audit.map((a) => a.event)).toEqual(
      expect.arrayContaining(['action.started', 'action.executed']),
    );

    // A redelivered command must not act twice.
    await orchestrator.handle(command(incident, diagnosis));
    expect(await actionsOf(incident.id)).toHaveLength(1);
    expect(ecsState.desiredCount).toBe(3);

    // Rollback → original count restored, incident handed to a human.
    await executor.rollback(tenantId, action.id, { type: 'user' as never, id: randomUUID() });
    expect(ecsState.desiredCount).toBe(2);
    const after = await actionsOf(incident.id);
    expect(after.find((a) => a.id === action.id)?.status).toBe('rolled_back');
    expect(after.find((a) => a.actionType === ActionType.ROLLBACK)).toMatchObject({
      status: 'executed',
      parentActionId: action.id,
    });
    expect(await incidentStatus(incident.id)).toBe(IncidentStatus.ESCALATED);
    expect(JSON.stringify(mocks.of('/chat.postMessage'))).toContain('human intervention required');
  });

  it('refuses to roll back an irreversible action', async () => {
    const { incident, diagnosis } = await incidentWithDiagnosis(
      0.93,
      'RESTART_SERVICE: restart auth',
    );
    await orchestrator.handle(command(incident, diagnosis));
    const [restart] = await actionsOf(incident.id);
    expect(restart).toMatchObject({ actionType: 'restart_service', status: 'executed' });
    await executor.rollback(tenantId, restart.id, { type: 'user' as never, id: randomUUID() });
    expect((await actionsOf(incident.id)).find((a) => a.id === restart.id)?.status).toBe(
      'executed',
    );
    const refused = await ds
      .getRepository(AuditLog)
      .findOne({ where: { tenantId, event: 'action.rollback_refused' } });
    expect(refused?.metadata.reason).toBe('restart_service is not reversible');
  });

  it('medium confidence → Slack approval; approving executes it', async () => {
    ecsState.desiredCount = 2;
    const { incident, diagnosis } = await incidentWithDiagnosis(
      0.72,
      'SCALE_SERVICE: add one task',
      {
        actionTier: ActionTier.DRAFT,
      },
    );
    await orchestrator.handle(command(incident, diagnosis));
    const [pending] = await actionsOf(incident.id);
    expect(pending).toMatchObject({ tier: 'draft', status: 'pending' });
    expect(pending.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(JSON.stringify(mocks.of('/chat.postMessage'))).toContain('sreai_approve');
    expect(ecsState.desiredCount).toBe(2);

    await orchestrator.handle({
      kind: 'action_decision',
      traceId: 't',
      tenantId,
      incidentId: incident.id,
      actionId: pending.id,
      decision: 'approve',
      actorType: 'slack',
      actorId: 'U123',
      reason: null,
    });
    const [done] = await actionsOf(incident.id);
    expect(done).toMatchObject({ status: 'executed', decidedBy: 'slack:U123' });
    expect(ecsState.desiredCount).toBe(3);
    expect(JSON.stringify(mocks.of('/chat.update'))).toContain('Approved by');
  });

  it('rejecting an approval escalates to PagerDuty', async () => {
    const { incident, diagnosis } = await incidentWithDiagnosis(
      0.7,
      'SCALE_SERVICE: add one task',
      {
        actionTier: ActionTier.DRAFT,
      },
    );
    await orchestrator.handle(command(incident, diagnosis));
    const [pending] = await actionsOf(incident.id);
    await orchestrator.handle({
      kind: 'action_decision',
      traceId: 't',
      tenantId,
      incidentId: incident.id,
      actionId: pending.id,
      decision: 'reject',
      actorType: 'user',
      actorId: randomUUID(),
      reason: 'not during the sale',
    });
    expect((await actionsOf(incident.id))[0].status).toBe('rejected');
    expect(mocks.of('/pagerduty')[0].body).toMatchObject({
      event_action: 'trigger',
      dedup_key: incident.id,
    });
    expect(await incidentStatus(incident.id)).toBe(IncidentStatus.ESCALATED);
  });

  it('an approval nobody answers expires and escalates', async () => {
    const { incident, diagnosis } = await incidentWithDiagnosis(
      0.7,
      'SCALE_SERVICE: add one task',
      {
        actionTier: ActionTier.DRAFT,
      },
    );
    await orchestrator.handle(command(incident, diagnosis));
    const [pending] = await actionsOf(incident.id);
    await executor.expire({
      tenantId,
      incidentId: incident.id,
      actionId: pending.id,
      traceId: 't',
    });
    expect((await actionsOf(incident.id)).find((a) => a.id === pending.id)?.status).toBe('expired');
    expect(await incidentStatus(incident.id)).toBe(IncidentStatus.ESCALATED);
    expect(mocks.of('/pagerduty')).toHaveLength(1);
  });

  it('low confidence → PagerDuty with the full context packet', async () => {
    const { incident, diagnosis } = await incidentWithDiagnosis(
      0.4,
      'INVESTIGATE: check upstream',
      {
        actionTier: ActionTier.ESCALATE,
        severity: IncidentSeverity.P1,
      },
    );
    await orchestrator.handle(command(incident, diagnosis));
    const [page] = mocks.of('/pagerduty');
    expect(page.body).toMatchObject({
      routing_key: 'rk-123',
      event_action: 'trigger',
      dedup_key: incident.id,
      payload: { severity: 'critical', source: 'auth-service' },
    });
    expect(JSON.stringify(page.body)).toContain('CPU saturation');
    expect(JSON.stringify(mocks.of('/chat.postMessage'))).toContain('Action required');
    expect(await incidentStatus(incident.id)).toBe(IncidentStatus.ESCALATED);

    // Resolution resolves the page and posts the summary.
    await ds
      .getRepository(Incident)
      .update({ tenantId, id: incident.id }, { status: IncidentStatus.RESOLVED, mttrSeconds: 300 });
    await orchestrator.handle({
      kind: 'incident_resolved',
      traceId: 't',
      tenantId,
      incidentId: incident.id,
    });
    expect(mocks.of('/pagerduty').map((c) => c.body.event_action)).toEqual(['trigger', 'resolve']);
    expect(JSON.stringify(mocks.of('/chat.postMessage'))).toContain('Resolved');
  });

  it('a service that always escalates is never auto-executed, whatever the confidence', async () => {
    const payments = await ds.getRepository(MonitoredService).save({
      tenantId,
      name: 'payment-service',
      alwaysEscalate: true,
      autoExecuteEnabled: true,
      metadata: { ecs: { cluster: 'prod', service: 'payments', maxTasks: 10 } },
    });
    ecsState.desiredCount = 2;
    const { incident, diagnosis } = await incidentWithDiagnosis(0.99, 'SCALE_SERVICE: add a task', {
      svc: payments,
    });
    await orchestrator.handle(command(incident, diagnosis));
    const actions = await actionsOf(incident.id);
    expect(actions.map((a) => a.actionType)).toEqual(['escalate']);
    expect(ecsState.desiredCount).toBe(2);
  });

  it('auto-execute is opt-in: without it, a high-confidence fix needs approval', async () => {
    const cautious = await ds.getRepository(MonitoredService).save({
      tenantId,
      name: 'search-service',
      autoExecuteEnabled: false,
      metadata: { ecs: { cluster: 'prod', service: 'search', maxTasks: 5 } },
    });
    const { incident, diagnosis } = await incidentWithDiagnosis(0.95, 'SCALE_SERVICE: add a task', {
      svc: cautious,
    });
    await orchestrator.handle(command(incident, diagnosis));
    expect((await actionsOf(incident.id))[0]).toMatchObject({ tier: 'draft', status: 'pending' });
  });

  it('a failed pre-check downgrades auto to an approval instead of acting', async () => {
    ecsState.desiredCount = 4; // already at maxTasks
    const { incident, diagnosis } = await incidentWithDiagnosis(0.95, 'SCALE_SERVICE: add a task');
    await orchestrator.handle(command(incident, diagnosis));
    const [action] = await actionsOf(incident.id);
    expect(action).toMatchObject({ tier: 'draft', status: ActionStatus.PENDING });
    expect(ecsState.desiredCount).toBe(4);
  });

  it('never pages or executes for a synthetic test alert, even at high confidence', async () => {
    ecsState.desiredCount = 2;
    const { incident, diagnosis } = await incidentWithDiagnosis(0.99, 'SCALE_SERVICE: add a task', {
      severity: IncidentSeverity.P1,
    });
    await ds
      .getRepository(Incident)
      .update({ tenantId, id: incident.id }, { labels: { sreai_test: 'true' } });
    await orchestrator.handle(command(incident, diagnosis));
    expect(ecsState.desiredCount).toBe(2);
    expect(mocks.of('/pagerduty')).toHaveLength(0);
    expect((await actionsOf(incident.id)).map((a) => a.actionType)).toEqual(['escalate']);
    expect(JSON.stringify(mocks.of('/chat.postMessage'))).toContain('Test alert diagnosed');
  });

  it('sends the daily digest once per tenant-local day at 09:00', async () => {
    const digest = app.get(DigestScheduler);
    const nineAmUtc = new Date(Date.UTC(2031, 0, 7, 9, 5));
    const beforeNine = new Date(Date.UTC(2031, 0, 8, 8, 5));
    expect(await digest.tick(nineAmUtc)).toBe(1);
    expect(JSON.stringify(mocks.of('/chat.postMessage'))).toContain('SRE.ai daily digest');
    expect(await digest.tick(new Date(nineAmUtc.getTime() + 3_600_000))).toBe(0);
    expect(await digest.tick(beforeNine)).toBe(0);
  });
});
