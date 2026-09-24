import { IncidentSeverity } from '@sreai/shared';
import { IntegrationReader } from '@sreai/database';
import { CollectorInput } from '../context.types';
import { isHighSignalFile } from './deploy.collector';
import { DependencyCollector } from './dependency.collector';
import { formatLogEvent, truncateLogEvents } from './log-line';
import { LogCollector } from './log.collector';
import { MetricsCollector, defaultMetricQueries, summarizeSeries } from './metrics.collector';

const input: CollectorInput = {
  incident: {
    id: 'i1',
    tenantId: 't1',
    title: 'HighCPU',
    description: null,
    severity: IncidentSeverity.P1,
    serviceName: 'auth-service',
    labels: {},
    detectedAt: new Date('2026-09-15T03:14:00Z'),
    fingerprint: null,
  },
  serviceId: 's1',
  metadata: {},
};

const noIntegrations = { get: jest.fn().mockResolvedValue(null) } as unknown as IntegrationReader;

describe('log lines', () => {
  it('flattens JSON logs and shortens timestamps', () => {
    expect(
      formatLogEvent({
        timestamp: new Date('2026-09-15T03:12:01Z'),
        message: '{"level":"error","msg":"pool exhausted","error":"timeout"}',
      }),
    ).toBe('03:12:01 ERROR pool exhausted error=timeout');
    expect(
      formatLogEvent({ timestamp: new Date('2026-09-15T03:12:01Z'), message: 'WARN slow query' }),
    ).toBe('03:12:01 WARN slow query');
  });

  it('keeps the first 50 and last 150 of >200 lines', () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      timestamp: new Date(i),
      message: `m${i}`,
    }));
    const kept = truncateLogEvents(events);
    expect(kept).toHaveLength(200);
    expect(kept[49].message).toBe('m49');
    expect(kept[50].message).toBe('m350');
    expect(kept[199].message).toBe('m499');
  });
});

describe('LogCollector', () => {
  it('reports not_configured when there is no log source', async () => {
    const collector = new LogCollector(noIntegrations, jest.fn());
    const { section } = await collector.collect(input);
    expect(section.status).toBe('not_configured');
  });

  it('reads CloudWatch Logs for services with a log group', async () => {
    const reader = {
      get: jest.fn().mockResolvedValue({
        config: { region: 'ap-south-1' },
        credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      }),
    } as unknown as IntegrationReader;
    const send = jest.fn().mockResolvedValue({
      events: [
        { timestamp: Date.parse('2026-09-15T03:12:02Z'), message: 'ERROR second' },
        { timestamp: Date.parse('2026-09-15T03:12:01Z'), message: 'ERROR first' },
      ],
    });
    const collector = new LogCollector(reader, () => ({ send }));
    const { section } = await collector.collect({ ...input, metadata: { logGroup: '/ecs/auth' } });
    expect(section.status).toBe('ok');
    expect(section.lines).toEqual(['03:12:01 ERROR first', '03:12:02 ERROR second']);
  });
});

describe('metrics', () => {
  it('summarises a series against its pre-alert baseline', () => {
    const alertAt = new Date('2026-09-15T03:14:00Z');
    const base = alertAt.getTime() / 1000 - 30 * 60;
    const values: [number, string][] = Array.from({ length: 31 }, (_, i) => [
      base + i * 60,
      i < 25 ? '0.3' : '0.94',
    ]);
    const line = summarizeSeries('cpu_cores', { metric: { pod: 'auth-1' }, values }, alertAt);
    expect(line).toContain('cpu_cores: peak 0.94 at');
    expect(line).toContain('baseline 0.3');
    expect(line).toContain('3.1x baseline');
    expect(line).toContain('pod="auth-1"');
  });

  it('builds default queries scoped to the service', () => {
    expect(defaultMetricQueries('auth-service').error_rate).toContain('service="auth-service"');
  });

  it('reports not_configured without Prometheus or Grafana', async () => {
    const { section } = await new MetricsCollector(noIntegrations).collect(input);
    expect(section.status).toBe('not_configured');
  });
});

describe('deploy', () => {
  it('flags config, dependency and infra changes as high-signal', () => {
    expect(isHighSignalFile('config/redis.ts')).toBe(true);
    expect(isHighSignalFile('.env.production')).toBe(true);
    expect(isHighSignalFile('pnpm-lock.yaml')).toBe(true);
    expect(isHighSignalFile('src/handlers/login.ts')).toBe(false);
  });
});

describe('DependencyCollector', () => {
  it('never probes private/metadata addresses and reports them unhealthy', async () => {
    const { section } = await new DependencyCollector().collect({
      ...input,
      metadata: {
        dependencies: [{ name: 'metadata', healthUrl: 'http://169.254.169.254/latest' }],
      },
    });
    expect(section.lines).toEqual(['metadata: unhealthy (blocked: non-public address)']);
  });

  it('reports not_configured without targets', async () => {
    const { section } = await new DependencyCollector().collect(input);
    expect(section.status).toBe('not_configured');
  });
});
