import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SQSClient } from '@aws-sdk/client-sqs';
import { ApiKey, Integration, Tenant } from '@sreai/database';
import { createTestDatabase, TestDatabase } from '@sreai/database/testing';
import { QueueUrls, drainJsonMessages } from '@sreai/queue';
import { QUEUE_URLS, QueueInfraModule, SQS_CLIENT } from '@sreai/queue/nest';
import {
  AlertMessage,
  API_KEY_ROTATION_GRACE_MS,
  IntegrationType,
  encryptJson,
  generateApiKey,
} from '@sreai/shared';
import { configureHttpApp } from '@sreai/shared/nest';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureBodyParsers } from '../src/http/body-parsers';
import { SnsSignatureVerifier } from '../src/webhooks/sns/sns-message';
import { WebhooksModule } from '../src/webhooks/webhooks.module';

// Full ingestion path against real infrastructure: PostgreSQL (API keys,
// integrations), Redis (dedup/storm windows) and SQS (LocalStack or
// ElasticMQ at LOCALSTACK_ENDPOINT).
const ENCRYPTION_KEY = 'a'.repeat(64);

describe('Webhooks (e2e)', () => {
  let db: TestDatabase;
  let ds: DataSource;
  let app: INestApplication;
  let sqs: SQSClient;
  let urls: QueueUrls;
  let apiKey: string;
  let tenantId: string;
  const snsVerify = jest.fn().mockResolvedValue(true);

  beforeAll(async () => {
    process.env.LOCALSTACK_ENDPOINT ??= 'http://localhost:4566';
    process.env.SQS_QUEUE_NAME_PREFIX = `e2e-${randomBytes(4).toString('hex')}-`;
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;

    db = await createTestDatabase();
    ds = new DataSource(db.options);
    await ds.initialize();

    const tenant = await ds
      .getRepository(Tenant)
      .save({ name: 'Acme', slug: 'acme', settings: {} });
    tenantId = tenant.id;
    const key = generateApiKey();
    apiKey = key.plaintext;
    await ds.getRepository(ApiKey).save({
      tenantId,
      name: 'default',
      displayPrefix: key.displayPrefix,
      keyHash: key.hash,
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot(db.options),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1_000 }]),
        QueueInfraModule,
        WebhooksModule,
      ],
    })
      .overrideProvider(SnsSignatureVerifier)
      .useValue({ verify: snsVerify })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureBodyParsers(app as NestExpressApplication);
    configureHttpApp(app);
    await app.init();

    sqs = app.get(SQS_CLIENT);
    urls = app.get(QUEUE_URLS);
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
    await db?.destroy();
  });

  const prometheusPayload = (alertname: string, severity = 'critical') => ({
    version: '4',
    status: 'firing',
    alerts: [
      {
        status: 'firing',
        labels: { alertname, service: 'auth-service', severity },
        annotations: { summary: 'CPU > 90% for 5 minutes' },
        startsAt: '2026-09-15T03:14:00Z',
      },
    ],
  });

  it('accepts a Prometheus alert, returns 200 fast and enqueues it on the P1 queue', async () => {
    const started = Date.now();
    const res = await request(app.getHttpServer())
      .post(`/webhooks/prometheus/${apiKey}`)
      .send(prometheusPayload('HighCPU'))
      .expect(200);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(res.body).toMatchObject({ success: true, data: { accepted: 1, duplicates: 0 } });

    const messages = await drainJsonMessages<AlertMessage>(sqs, urls.p1);
    expect(messages).toHaveLength(1);
    expect(messages[0].alert).toMatchObject({
      tenantId,
      serviceName: 'auth-service',
      title: 'HighCPU',
      severity: 'p1',
    });
    expect(messages[0].traceId).toEqual(res.headers['x-trace-id']);
  });

  it('deduplicates the same alert within the window', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/prometheus')
      .set('X-API-Key', apiKey)
      .send(prometheusPayload('HighCPU'))
      .expect(200);
    expect(res.body.data).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it('routes P2/P3 alerts to the normal-priority queue', async () => {
    await request(app.getHttpServer())
      .post(`/webhooks/prometheus/${apiKey}`)
      .send(prometheusPayload('DiskFilling', 'warning'))
      .expect(200);
    const messages = await drainJsonMessages<AlertMessage>(sqs, urls.p2);
    expect(messages.map((m) => m.alert.title)).toEqual(['DiskFilling']);
  });

  it('rejects unknown API keys with 401 and malformed payloads with 400', async () => {
    const unauthorized = await request(app.getHttpServer())
      .post(`/webhooks/prometheus/sreai_${'x'.repeat(43)}`)
      .send(prometheusPayload('X'))
      .expect(401);
    expect(unauthorized.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });

    const bad = await request(app.getHttpServer())
      .post(`/webhooks/prometheus/${apiKey}`)
      .send({ alerts: [{ status: 'exploded' }] })
      .expect(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
  });

  it('honours a rotated key until its grace period ends', async () => {
    const rotated = generateApiKey();
    await ds.getRepository(ApiKey).save({
      tenantId,
      name: 'rotated',
      displayPrefix: rotated.displayPrefix,
      keyHash: rotated.hash,
      expiresAt: new Date(Date.now() + API_KEY_ROTATION_GRACE_MS),
    });
    const expired = generateApiKey();
    await ds.getRepository(ApiKey).save({
      tenantId,
      name: 'expired',
      displayPrefix: expired.displayPrefix,
      keyHash: expired.hash,
      expiresAt: new Date(Date.now() - 1_000),
    });
    await request(app.getHttpServer())
      .post(`/webhooks/generic/${rotated.plaintext}`)
      .send({ title: 'Rotated key works', service: 'x' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/webhooks/generic/${expired.plaintext}`)
      .send({ title: 'Expired key fails', service: 'x' })
      .expect(401);
    await drainJsonMessages(sqs, urls.p2);
  });

  it('maps generic webhooks with the tenant field mapping', async () => {
    // Own tenant: webhook config is cached per tenant for 60s, and earlier
    // tests already resolved this suite's tenant to the default mapping.
    const other = await ds
      .getRepository(Tenant)
      .save({ name: 'Mapped', slug: 'mapped', settings: {} });
    const otherKey = generateApiKey();
    await ds.getRepository(ApiKey).save({
      tenantId: other.id,
      name: 'default',
      displayPrefix: otherKey.displayPrefix,
      keyHash: otherKey.hash,
    });
    await ds.getRepository(Integration).save({
      tenantId: other.id,
      type: IntegrationType.GENERIC,
      encryptedCredentials: encryptJson({}, Buffer.from(ENCRYPTION_KEY, 'hex')),
      config: {
        fieldMapping: { title: 'check.name', service: 'check.target', severity: 'check.level' },
        severityMap: { red: 'p1' },
      },
    });
    await request(app.getHttpServer())
      .post(`/webhooks/generic/${otherKey.plaintext}`)
      .send({ check: { name: 'Homepage down', target: 'web', level: 'red' } })
      .expect(200);
    const [message] = await drainJsonMessages<AlertMessage>(sqs, urls.p1);
    expect(message.alert).toMatchObject({
      title: 'Homepage down',
      serviceName: 'web',
      severity: 'p1',
    });
  });

  it('accepts CloudWatch alarms delivered by SNS as text/plain', async () => {
    const alarm = {
      AlarmName: 'orders-5xx',
      NewStateValue: 'ALARM',
      NewStateReason: 'Threshold crossed',
      Trigger: { Dimensions: [{ name: 'ServiceName', value: 'orders' }] },
    };
    const sns = {
      Type: 'Notification',
      MessageId: 'm1',
      TopicArn: 'arn:aws:sns:ap-south-1:1:alarms',
      Message: JSON.stringify(alarm),
      Timestamp: new Date().toISOString(),
      SignatureVersion: '2',
      Signature: 'sig',
      SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/cert.pem',
    };
    await request(app.getHttpServer())
      .post(`/webhooks/cloudwatch/${apiKey}`)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(sns))
      .expect(200);
    expect(snsVerify).toHaveBeenCalled();
    const [message] = await drainJsonMessages<AlertMessage>(sqs, urls.p2);
    expect(message.alert).toMatchObject({ source: 'cloudwatch', serviceName: 'orders' });

    snsVerify.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .post(`/webhooks/cloudwatch/${apiKey}`)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(sns))
      .expect(401);
  });
});
