import { createHmac, randomBytes, randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  Action,
  ApiKey,
  CitationFailure,
  Diagnosis,
  Incident,
  MonitoredService,
  User,
} from '@sreai/database';
import { createTestDatabase, TestDatabase } from '@sreai/database/testing';
import { QueueUrls, createRedisClient, drainJsonMessages } from '@sreai/queue';
import { QUEUE_URLS, QueueInfraModule, SQS_CLIENT } from '@sreai/queue/nest';
import {
  ActionCommand,
  ActionStatus,
  ActionTier,
  ActionType,
  IncidentQueueMessage,
  IncidentSeverity,
  IncidentStatus,
  REALTIME_CHANNEL,
  UserRole,
  encryptJson,
} from '@sreai/shared';
import { configureHttpApp } from '@sreai/shared/nest';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { io as ioClient, Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FEATURE_MODULES, GLOBAL_GUARDS } from '../src/app.module';

const SLACK_SIGNING_SECRET = 'slack-signing-secret-for-tests';

describe('API gateway (e2e: real Postgres, Redis, SQS)', () => {
  let db: TestDatabase;
  let ds: DataSource;
  let app: INestApplication;
  let sqs: SQSClient;
  let urls: QueueUrls;
  let baseUrl: string;

  const tenants: Record<'a' | 'b', { tenantId: string; token: string; userId: string }> =
    {} as never;

  beforeAll(async () => {
    Object.assign(process.env, {
      LOCALSTACK_ENDPOINT: process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:4566',
      SQS_QUEUE_NAME_PREFIX: `e2e-${randomBytes(4).toString('hex')}-`,
      JWT_SECRET: 'e2e-test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'e2e-test-refresh-secret-at-least-32-characters',
      ENCRYPTION_KEY: 'd'.repeat(64),
      SLACK_SIGNING_SECRET,
      PUBLIC_WEBHOOK_BASE_URL: 'https://hooks.sre.ai',
    });
    db = await createTestDatabase();
    ds = new DataSource(db.options);
    await ds.initialize();

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot(db.options),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
        QueueInfraModule,
        ...FEATURE_MODULES,
      ],
      providers: GLOBAL_GUARDS,
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.use(cookieParser());
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    sqs = app.get(SQS_CLIENT);
    urls = app.get(QUEUE_URLS);

    for (const key of ['a', 'b'] as const) {
      const res = await request(baseUrl)
        .post('/auth/register')
        .send({
          tenantName: `Tenant ${key}`,
          email: `owner-${key}@example.com`,
          password: 'password123',
        })
        .expect(201);
      tenants[key] = {
        tenantId: res.body.data.user.tenantId,
        token: res.body.data.accessToken,
        userId: res.body.data.user.id,
      };
    }
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
    await db?.destroy();
  });

  const api = (who: 'a' | 'b') => ({
    get: (path: string) =>
      request(baseUrl).get(path).set('Authorization', `Bearer ${tenants[who].token}`),
    post: (path: string, body: object = {}) =>
      request(baseUrl).post(path).set('Authorization', `Bearer ${tenants[who].token}`).send(body),
    patch: (path: string, body: object) =>
      request(baseUrl).patch(path).set('Authorization', `Bearer ${tenants[who].token}`).send(body),
    delete: (path: string) =>
      request(baseUrl).delete(path).set('Authorization', `Bearer ${tenants[who].token}`),
  });

  async function seedIncident(who: 'a' | 'b', overrides: Partial<Incident> = {}) {
    const tenantId = tenants[who].tenantId;
    const service = await ds
      .getRepository(MonitoredService)
      .save({ tenantId, name: `svc-${randomUUID().slice(0, 6)}` });
    const incident = await ds.getRepository(Incident).save({
      tenantId,
      serviceId: service.id,
      severity: IncidentSeverity.P1,
      status: IncidentStatus.ACTING,
      title: `HighCPU on ${service.name}`,
      sourceAlert: {},
      detectedAt: new Date(),
      fingerprint: randomBytes(32).toString('hex'),
      ...overrides,
    });
    const diagnosis = await ds.getRepository(Diagnosis).save({
      tenantId,
      incidentId: incident.id,
      hypothesis: 'Redis pool exhausted after a config change.',
      confidence: 0.72,
      llmConfidence: 0.8,
      evidence: [
        { claim: 'Pool exhausted', source: 'logs', reference: 'connection pool exhausted' },
      ],
      recommendedAction: 'SCALE_SERVICE: add a task',
      actionTier: ActionTier.DRAFT,
      reasoning: 'Errors after deploy.',
      citationsPassed: true,
      citationFailureRate: 0.25,
      contextUsed: { prompt: 'SECRET PROMPT', collectors: [{ source: 'logs', status: 'ok' }] },
    });
    await ds.getRepository(CitationFailure).save({
      tenantId,
      diagnosisId: diagnosis.id,
      claim: 'Disk full',
      source: 'logs',
      reference: 'No space left',
      failureReason: 'not_found',
    });
    return { incident, diagnosis, service };
  }

  describe('tenant isolation', () => {
    it("never shows or acts on another tenant's incidents", async () => {
      const { incident: mine } = await seedIncident('a');
      const { incident: theirs } = await seedIncident('b');

      const list = await api('a').get('/incidents').expect(200);
      const ids = list.body.data.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);

      await api('a').get(`/incidents/${theirs.id}`).expect(404);
      await api('a').post(`/incidents/${theirs.id}/resolve`).expect(404);
      await api('a').get(`/incidents/${theirs.id}/timeline`).expect(404);
    });

    it('rejects requests without a valid token', async () => {
      await request(baseUrl).get('/incidents').expect(401);
      await request(baseUrl)
        .get('/incidents')
        .set('Authorization', 'Bearer forged.token.here')
        .expect(401);
    });
  });

  describe('incidents', () => {
    it('lists with filters and returns full detail with diagnosis and citation failures', async () => {
      const { incident } = await seedIncident('a', {
        severity: IncidentSeverity.P2,
        title: 'Latency spike on checkout',
      });
      const filtered = await api('a').get('/incidents?severity=p2&search=latency').expect(200);
      expect(filtered.body.data.items.map((i: { id: string }) => i.id)).toEqual([incident.id]);

      const detail = await api('a').get(`/incidents/${incident.id}`).expect(200);
      expect(detail.body.data.diagnosis).toMatchObject({
        hypothesis: 'Redis pool exhausted after a config change.',
        confidence: 0.72,
        citationFailures: [{ reference: 'No space left', reason: 'not_found' }],
      });
      // The raw prompt stays server-side.
      expect(JSON.stringify(detail.body)).not.toContain('SECRET PROMPT');
    });

    it('queues a manual resolve for the diagnosis-service', async () => {
      const { incident } = await seedIncident('a');
      await api('a')
        .post(`/incidents/${incident.id}/resolve`, { note: 'fixed the pool size' })
        .expect(202);
      const messages = await drainJsonMessages<IncidentQueueMessage>(sqs, urls.p2);
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'manual_resolve',
          incidentId: incident.id,
          note: 'fixed the pool size',
        }),
      );
    });

    it('queues approvals and validates rollbacks before queuing them', async () => {
      const { incident, diagnosis } = await seedIncident('a');
      const tenantId = tenants.a.tenantId;
      const pending = await ds.getRepository(Action).save({
        tenantId,
        incidentId: incident.id,
        tier: ActionTier.DRAFT,
        status: ActionStatus.PENDING,
        actionType: ActionType.SCALE_SERVICE,
        description: 'Scale out',
        payload: { diagnosisId: diagnosis.id },
        expiresAt: new Date(Date.now() + 60_000),
      });
      await api('a').post(`/incidents/${incident.id}/actions/${pending.id}/approve`).expect(202);
      const commands = await drainJsonMessages<ActionCommand>(sqs, urls.actions);
      expect(commands).toContainEqual(
        expect.objectContaining({
          kind: 'action_decision',
          actionId: pending.id,
          decision: 'approve',
          actorType: 'user',
        }),
      );

      const restart = await ds.getRepository(Action).save({
        tenantId,
        incidentId: incident.id,
        tier: ActionTier.AUTO,
        status: ActionStatus.EXECUTED,
        actionType: ActionType.RESTART_SERVICE,
        description: 'Restart',
        payload: {},
        executedAt: new Date(),
      });
      const irreversible = await api('a')
        .post(`/incidents/${incident.id}/actions/${restart.id}/rollback`)
        .expect(422);
      expect(irreversible.body.error.message).toContain('not reversible');

      const oldScale = await ds.getRepository(Action).save({
        tenantId,
        incidentId: incident.id,
        tier: ActionTier.AUTO,
        status: ActionStatus.EXECUTED,
        actionType: ActionType.SCALE_SERVICE,
        description: 'Scale',
        payload: {},
        executedAt: new Date(Date.now() - 2 * 3600_000),
      });
      await api('a').post(`/incidents/${incident.id}/actions/${oldScale.id}/rollback`).expect(409);
    });

    it('exports the audit trail as CSV', async () => {
      const { incident } = await seedIncident('a');
      const res = await api('a').get(`/incidents/${incident.id}/audit?format=csv`).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0]).toBe('at,event,actor_type,actor_id,before,after,metadata');
    });
  });

  describe('RBAC', () => {
    it('lets members read but not change tenant configuration', async () => {
      await ds.getRepository(User).save({
        tenantId: tenants.a.tenantId,
        email: 'member@example.com',
        passwordHash: await bcrypt.hash('password123', 4),
        role: UserRole.MEMBER,
      });
      const login = await request(baseUrl)
        .post('/auth/login')
        .send({ email: 'member@example.com', password: 'password123' })
        .expect(200);
      const token = login.body.data.accessToken as string;
      await request(baseUrl)
        .get('/integrations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(baseUrl)
        .post('/integrations')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'pagerduty', credentials: { routingKey: 'x' } })
        .expect(403);
      await request(baseUrl)
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'k' })
        .expect(403);
    });
  });

  describe('integrations', () => {
    it('stores credentials encrypted and never returns them', async () => {
      const created = await api('a')
        .post('/integrations', {
          type: 'slack',
          config: { channel: '#incidents', teamId: 'T123' },
          credentials: { botToken: 'xoxb-super-secret' },
        })
        .expect(201);
      expect(created.body.data).toMatchObject({ type: 'slack', credentialFields: ['botToken'] });
      const list = await api('a').get('/integrations').expect(200);
      expect(JSON.stringify(list.body)).not.toContain('xoxb-super-secret');
      const [row] = await ds.query(`SELECT encrypted_credentials FROM integrations WHERE id = $1`, [
        created.body.data.id,
      ]);
      expect(row.encrypted_credentials).not.toContain('xoxb-super-secret');

      await api('a')
        .post('/integrations', { type: 'slack', config: { channel: '#x' } })
        .expect(409);
      const invalid = await api('a')
        .post('/integrations', { type: 'prometheus', config: { url: 'not a url' } })
        .expect(400);
      expect(invalid.body.error.details.join(' ')).toContain('config.url');
    });

    it('updates config without re-sending secrets', async () => {
      const created = await api('a')
        .post('/integrations', { type: 'github', config: {}, credentials: { token: 'ghp_x' } })
        .expect(201);
      const updated = await api('a')
        .patch(`/integrations/${created.body.data.id}`, { config: { draftPrEnabled: true } })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        config: { draftPrEnabled: true },
        credentialFields: ['token'],
      });
    });

    it('sends a synthetic, clearly-labelled test alert through the pipeline for alert sources', async () => {
      const created = await api('a').post('/integrations', { type: 'cloudwatch' }).expect(201);
      const res = await api('a').post(`/integrations/${created.body.data.id}/test`).expect(200);
      expect(res.body.data.ok).toBe(true);
      const messages = await drainJsonMessages<IncidentQueueMessage>(sqs, urls.p2);
      const alert = messages.find((m) => m.kind === 'alert');
      expect(alert && alert.kind === 'alert' && alert.alert.labels.sreai_test).toBe('true');
    });
  });

  describe('API keys', () => {
    it('shows a key once, rotates with a grace period, and revokes', async () => {
      const created = await api('a').post('/api-keys', { name: 'alertmanager' }).expect(201);
      const { id, key, webhookUrls } = created.body.data;
      expect(key).toMatch(/^sreai_/);
      expect(webhookUrls.prometheus).toBe(`https://hooks.sre.ai/webhooks/prometheus/${key}`);

      const list = await api('a').get('/api-keys').expect(200);
      expect(JSON.stringify(list.body)).not.toContain(key);

      const rotated = await api('a').post(`/api-keys/${id}/rotate`).expect(201);
      expect(rotated.body.data.key).not.toBe(key);
      const old = await ds.getRepository(ApiKey).findOneByOrFail({ id });
      expect(old.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

      await api('a').delete(`/api-keys/${rotated.body.data.id}`).expect(204);
      await api('b').delete(`/api-keys/${id}`).expect(404);
    });
  });

  describe('settings', () => {
    it('validates thresholds and timezones', async () => {
      await api('a')
        .patch('/settings', { settings: { autoThreshold: 0.5, draftThreshold: 0.7 } })
        .expect(400);
      await api('a')
        .patch('/settings', { settings: { timezone: 'Mars/Olympus' } })
        .expect(400);
      const ok = await api('a')
        .patch('/settings', {
          settings: {
            timezone: 'Asia/Kolkata',
            autoThreshold: 0.9,
            silenceWindows: [{ days: [1, 2], start: '22:00', end: '07:00' }],
          },
        })
        .expect(200);
      expect(ok.body.data).toMatchObject({
        timezone: 'Asia/Kolkata',
        autoThreshold: 0.9,
        draftThreshold: null,
      });
    });
  });

  describe('analytics', () => {
    it('computes MTTR, auto-resolve rate and recurrence for the tenant only', async () => {
      const tenantId = tenants.b.tenantId;
      const fingerprint = randomBytes(32).toString('hex');
      for (const mttr of [120, 360]) {
        const { incident } = await seedIncident('b', {
          status: IncidentStatus.RESOLVED,
          mttrSeconds: mttr,
          resolvedAt: new Date(),
          fingerprint,
          title: 'Recurring OOM',
        });
        await ds.getRepository(Action).save({
          tenantId,
          incidentId: incident.id,
          tier: ActionTier.AUTO,
          status: ActionStatus.EXECUTED,
          actionType: ActionType.RESTART_SERVICE,
          description: 'Restart',
          payload: {},
          requestedBy: 'system',
          executedAt: new Date(),
        });
      }
      const res = await api('b').get('/analytics/overview?days=7').expect(200);
      const data = res.body.data;
      expect(data.autoResolve).toMatchObject({ autoResolved: 2, resolved: 2, rate: 1 });
      expect(data.topRecurring[0]).toMatchObject({
        title: 'Recurring OOM',
        occurrences: 2,
        avgMttrSeconds: 240,
      });
      expect(data.confidenceDistribution).toHaveLength(10);
      expect(data.totals.incidents).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Slack interactivity', () => {
    function signed(body: string, ts = Math.floor(Date.now() / 1000)) {
      const sig = `v0=${createHmac('sha256', SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest('hex')}`;
      return request(baseUrl)
        .post('/integrations/slack/interactions')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', String(ts))
        .set('X-Slack-Signature', sig)
        .send(body);
    }

    it('turns a signed button click into a command, and rejects forgeries and other workspaces', async () => {
      // Tenant A's Slack workspace is T123 (created here if an earlier test hasn't).
      await ds.query(
        `INSERT INTO integrations (tenant_id, type, encrypted_credentials, config)
         VALUES ($1, 'slack', $2, $3) ON CONFLICT (tenant_id, type) DO NOTHING`,
        [
          tenants.a.tenantId,
          encryptJson({}, Buffer.from('d'.repeat(64), 'hex')),
          { channel: '#incidents', teamId: 'T123' },
        ],
      );
      const { incident } = await seedIncident('a');
      const action = await ds.getRepository(Action).save({
        tenantId: tenants.a.tenantId,
        incidentId: incident.id,
        tier: ActionTier.DRAFT,
        status: ActionStatus.PENDING,
        actionType: ActionType.SCALE_SERVICE,
        description: 'Scale',
        payload: {},
      });
      const payload = (team: string) =>
        `payload=${encodeURIComponent(
          JSON.stringify({
            type: 'block_actions',
            user: { id: 'U42' },
            team: { id: team },
            actions: [
              {
                action_id: 'sreai_approve',
                value: JSON.stringify({
                  tenantId: tenants.a.tenantId,
                  incidentId: incident.id,
                  actionId: action.id,
                }),
              },
            ],
          }),
        )}`;

      await signed(payload('T123')).expect(200);
      const commands = await drainJsonMessages<ActionCommand>(sqs, urls.actions);
      expect(commands).toContainEqual(
        expect.objectContaining({
          kind: 'action_decision',
          actionId: action.id,
          actorType: 'slack',
          actorId: 'U42',
        }),
      );

      await signed(payload('T999')).expect(403);
      await request(baseUrl)
        .post('/integrations/slack/interactions')
        .set('X-Slack-Request-Timestamp', String(Math.floor(Date.now() / 1000)))
        .set('X-Slack-Signature', 'v0=forged')
        .send(payload('T123'))
        .expect(401);
      await signed(payload('T123'), Math.floor(Date.now() / 1000) - 3600).expect(401);
    });
  });

  describe('realtime', () => {
    it("delivers incident events only to the owning tenant's sockets", async () => {
      const connect = (token: string): Promise<Socket> =>
        new Promise((resolve, reject) => {
          const socket = ioClient(baseUrl, {
            path: '/realtime',
            auth: { token },
            transports: ['websocket'],
          });
          socket.on('connect', () => resolve(socket));
          socket.on('connect_error', reject);
        });
      const a = await connect(tenants.a.token);
      const b = await connect(tenants.b.token);
      const receivedA: unknown[] = [];
      const receivedB: unknown[] = [];
      a.on('incident.event', (e) => receivedA.push(e));
      b.on('incident.event', (e) => receivedB.push(e));
      await new Promise((r) => setTimeout(r, 200));

      const redis = createRedisClient();
      await redis.publish(
        REALTIME_CHANNEL,
        JSON.stringify({
          tenantId: tenants.a.tenantId,
          type: 'incident.updated',
          incidentId: randomUUID(),
          status: 'acting',
          payload: {},
          at: new Date().toISOString(),
        }),
      );
      await new Promise((r) => setTimeout(r, 500));
      await redis.quit();

      expect(receivedA).toHaveLength(1);
      expect(receivedB).toHaveLength(0);
      a.close();
      b.close();
    });

    it('drops connections without a valid token', async () => {
      const socket = ioClient(baseUrl, {
        path: '/realtime',
        auth: { token: 'nope' },
        transports: ['websocket'],
      });
      let timer: NodeJS.Timeout | undefined;
      const disconnected = await new Promise<boolean>((resolve) => {
        socket.on('disconnect', () => resolve(true));
        timer = setTimeout(() => resolve(false), 2_000);
      });
      clearTimeout(timer);
      expect(disconnected).toBe(true);
      socket.close();
    });
  });
});
