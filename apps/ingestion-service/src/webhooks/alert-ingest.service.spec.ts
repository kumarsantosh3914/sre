import { ServiceUnavailableException } from '@nestjs/common';
import { QueueUrls, SqsPublisher } from '@sreai/queue';
import {
  AlertMessage,
  AlertSource,
  AlertStatus,
  IncidentSeverity,
  STORM_THRESHOLD,
} from '@sreai/shared';
import IORedis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { AlertIngestService, redisKeys } from './alert-ingest.service';
import { RawAlert } from './normalizers/raw-alert';

const TENANT = '11111111-1111-4111-8111-111111111111';
const urls: QueueUrls = {
  p1: 'p1',
  p2: 'p2',
  incidentsDlq: 'dlq',
  actions: 'a',
  actionsDlq: 'adlq',
};

function raw(overrides: Partial<RawAlert> = {}): RawAlert {
  return {
    status: AlertStatus.FIRING,
    serviceName: 'auth-service',
    severity: IncidentSeverity.P2,
    title: 'HighCPU',
    description: null,
    labels: {},
    firedAt: new Date(),
    resolvedAt: null,
    rawPayload: {},
    ...overrides,
  };
}

describe('AlertIngestService', () => {
  let redis: IORedis;
  let sent: { url: string; body: AlertMessage }[];
  let service: AlertIngestService;
  let failSends: boolean;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as IORedis;
    await redis.flushall();
    sent = [];
    failSends = false;
    const publisher = {
      sendJson: jest.fn(async (url: string, body: AlertMessage) => {
        if (failSends) throw new Error('SQS down');
        sent.push({ url, body });
        return 'id';
      }),
    } as unknown as SqsPublisher;
    service = new AlertIngestService(redis, urls, publisher);
  });

  it('routes P1 to the p1 queue and P2/P3 to p2', async () => {
    await service.ingest(TENANT, AlertSource.PROMETHEUS, [
      raw({ title: 'A', severity: IncidentSeverity.P1 }),
      raw({ title: 'B', severity: IncidentSeverity.P3 }),
    ]);
    const byTitle = Object.fromEntries(sent.map((s) => [s.body.alert.title, s.url]));
    expect(byTitle).toEqual({ A: 'p1', B: 'p2' });
    expect(sent[0].body.alert.tenantId).toBe(TENANT);
    expect(sent[0].body.alert.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('suppresses a duplicate within the 5 minute window', async () => {
    const first = await service.ingest(TENANT, AlertSource.PROMETHEUS, [raw()]);
    const second = await service.ingest(TENANT, AlertSource.GRAFANA, [raw({ title: 'highcpu' })]);
    expect(first).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(second).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(sent).toHaveLength(1);
    expect(
      await redis.ttl(redisKeys.dedupeFiring(TENANT, sent[0].body.alert.fingerprint)),
    ).toBeLessThanOrEqual(300);
  });

  it('lets a resolution through and re-opens the window for a re-fire', async () => {
    await service.ingest(TENANT, AlertSource.PROMETHEUS, [raw()]);
    const resolved = await service.ingest(TENANT, AlertSource.PROMETHEUS, [
      raw({ status: AlertStatus.RESOLVED, resolvedAt: new Date() }),
    ]);
    const refire = await service.ingest(TENANT, AlertSource.PROMETHEUS, [raw()]);
    expect(resolved.accepted).toBe(1);
    expect(refire.accepted).toBe(1);
  });

  it('groups an alert storm (25 alerts in 60s) under one storm key with one P1 summary', async () => {
    const alerts = Array.from({ length: 25 }, (_, i) =>
      raw({ title: `Alert ${String.fromCharCode(65 + i)}` }),
    );
    for (const alert of alerts) {
      await service.ingest(TENANT, AlertSource.PROMETHEUS, [alert]);
    }
    const summaries = sent.filter((s) => s.body.alert.isStormSummary);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ url: 'p1' });
    expect(summaries[0].body.alert.severity).toBe(IncidentSeverity.P1);

    const stormKey = summaries[0].body.alert.stormKey;
    const grouped = sent.filter((s) => !s.body.alert.isStormSummary && s.body.alert.stormKey);
    expect(grouped).toHaveLength(25 - STORM_THRESHOLD);
    expect(grouped.every((s) => s.body.alert.stormKey === stormKey && s.url === 'p1')).toBe(true);
  });

  it('releases the dedup key and returns 503 when SQS is down', async () => {
    failSends = true;
    await expect(service.ingest(TENANT, AlertSource.PROMETHEUS, [raw()])).rejects.toThrow(
      ServiceUnavailableException,
    );
    failSends = false;
    // The source's retry must not be swallowed as a duplicate.
    const retry = await service.ingest(TENANT, AlertSource.PROMETHEUS, [raw()]);
    expect(retry.accepted).toBe(1);
  });
});
