import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Action,
  AuditLog,
  Diagnosis,
  Incident,
  MonitoredService,
  Postmortem,
  ResolutionPattern,
  Runbook,
  Tenant,
} from '@sreai/database';
import { createTestDatabase, TestDatabase } from '@sreai/database/testing';
import { QueueInfraModule } from '@sreai/queue/nest';
import {
  ActionStatus,
  ActionTier,
  ActionType,
  AuditActorType,
  IncidentSeverity,
  IncidentStatus,
} from '@sreai/shared';
import { DataSource } from 'typeorm';
import { MemoryModule } from '../src/memory/memory.module';
import { MemoryService } from '../src/memory/memory.service';
import { MockUpstreams } from './mock-upstreams';

describe('Memory layer (e2e: post-mortems, patterns, runbooks)', () => {
  const upstreams = new MockUpstreams();
  let db: TestDatabase;
  let ds: DataSource;
  let app: INestApplication;
  let memory: MemoryService;
  let tenantId: string;
  let service: MonitoredService;
  const fingerprint = randomBytes(32).toString('hex');

  beforeAll(async () => {
    await upstreams.start();
    upstreams.chatHandler = () => ({
      measures: [
        'Alert on Redis pool utilisation above 80%',
        'Load-test pool size changes before deploying',
        'Add a circuit breaker around Redis calls',
      ],
    });
    Object.assign(process.env, {
      LOCALSTACK_ENDPOINT: process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:4566',
      SQS_QUEUE_NAME_PREFIX: `e2e-${randomBytes(4).toString('hex')}-`,
      BULLMQ_PREFIX: `e2e-${randomBytes(4).toString('hex')}`,
      CONSUMERS_ENABLED: 'false',
      WORKERS_ENABLED: 'false',
      ENCRYPTION_KEY: 'e'.repeat(64),
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: `${upstreams.url}/v1`,
    });
    db = await createTestDatabase();
    ds = new DataSource(db.options);
    await ds.initialize();
    const tenant = await ds
      .getRepository(Tenant)
      .save({ name: 'Acme', slug: 'acme', settings: {} });
    tenantId = tenant.id;
    service = await ds.getRepository(MonitoredService).save({ tenantId, name: 'auth-service' });

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot(db.options),
        QueueInfraModule,
        MemoryModule,
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    memory = app.get(MemoryService);
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
    await db?.destroy();
    await upstreams.stop();
  });

  async function resolvedIncident(): Promise<Incident> {
    const detectedAt = new Date(Date.now() - 600_000);
    const incident = await ds.getRepository(Incident).save({
      tenantId,
      serviceId: service.id,
      severity: IncidentSeverity.P2,
      status: IncidentStatus.RESOLVED,
      title: 'RedisPoolExhausted <script>',
      sourceAlert: {},
      detectedAt,
      resolvedAt: new Date(),
      mttrSeconds: 240,
      fingerprint,
    });
    await ds.getRepository(Diagnosis).save({
      tenantId,
      incidentId: incident.id,
      hypothesis: 'Redis connection pool exhausted under peak load.',
      confidence: 0.9,
      evidence: [
        {
          claim: 'Pool exhausted',
          source: 'logs',
          reference: 'connection pool exhausted (max=10)',
        },
      ],
      recommendedAction: 'RESTART_SERVICE: restart auth-service',
      actionTier: ActionTier.AUTO,
      reasoning: 'Pool errors precede timeouts.',
    });
    await ds.getRepository(Action).save({
      tenantId,
      incidentId: incident.id,
      tier: ActionTier.AUTO,
      status: ActionStatus.EXECUTED,
      actionType: ActionType.RESTART_SERVICE,
      description: 'Restart ECS service prod/auth (rolling, force new deployment)',
      payload: {},
      executedAt: new Date(),
    });
    for (const event of [
      'incident.created',
      'diagnosis.completed',
      'action.executed',
      'incident.resolved',
    ]) {
      await ds
        .getRepository(AuditLog)
        .save({
          tenantId,
          incidentId: incident.id,
          actorType: AuditActorType.SYSTEM,
          event,
          metadata: {},
        });
    }
    return incident;
  }

  it('writes a structured post-mortem with timeline, evidence, action and prevention', async () => {
    const incident = await resolvedIncident();
    const outcome = await memory.process(tenantId, incident.id);
    const pm = await ds
      .getRepository(Postmortem)
      .findOneByOrFail({ tenantId, incidentId: incident.id });
    expect(outcome.postmortemId).toBe(pm.id);
    for (const heading of [
      '# Post-Mortem:',
      '## Timeline',
      '## Root Cause',
      '## Evidence',
      '## Action Taken',
      '## Prevention',
    ]) {
      expect(pm.markdown).toContain(heading);
    }
    expect(pm.markdown).toContain('**MTTR:** 4m 0s');
    expect(pm.markdown).toContain('Outcome: success');
    expect(pm.markdown).not.toContain('<script>');
    expect(pm.prevention).toHaveLength(3);
    expect(outcome.pattern).toEqual({
      actionType: 'restart_service',
      occurrences: 1,
      successes: 1,
    });
    expect(outcome.runbookId).toBeNull();
  });

  it('is idempotent when the job is retried', async () => {
    const [pattern] = await ds.getRepository(ResolutionPattern).find({ where: { tenantId } });
    const incidentId = pattern.incidentIds[0];
    await memory.process(tenantId, incidentId);
    const again = await ds.getRepository(ResolutionPattern).findOneByOrFail({ id: pattern.id });
    expect(again.occurrences).toBe(1);
    expect(await ds.getRepository(Postmortem).count({ where: { tenantId, incidentId } })).toBe(1);
  });

  it('drafts a runbook once the same fix has worked three times', async () => {
    await memory.process(tenantId, (await resolvedIncident()).id);
    const third = await memory.process(tenantId, (await resolvedIncident()).id);
    expect(third.pattern).toEqual({ actionType: 'restart_service', occurrences: 3, successes: 3 });
    expect(third.runbookId).not.toBeNull();

    const runbook = await ds.getRepository(Runbook).findOneByOrFail({ id: third.runbookId! });
    expect(runbook.signature).toBe(fingerprint);
    expect(runbook.markdown).toContain('## Resolution');
    expect(runbook.markdown).toContain('resolved it 3 times');
    expect(runbook.markdown).toContain('Alert on Redis pool utilisation above 80%');
    expect(runbook.incidentIds).toHaveLength(3);

    // A fourth success updates the same runbook to a new version.
    const fourth = await memory.process(tenantId, (await resolvedIncident()).id);
    const updated = await ds.getRepository(Runbook).findOneByOrFail({ id: fourth.runbookId! });
    expect(updated.id).toBe(runbook.id);
    expect(updated.version).toBe(2);
  });
});
