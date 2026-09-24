import { AlertStatus, IncidentSeverity } from '@sreai/shared';
import { plainToInstance } from 'class-transformer';
import { PrometheusWebhookDto } from '../dto/prometheus-webhook.dto';
import { GrafanaWebhookDto } from '../dto/grafana-webhook.dto';
import { normalizeCloudWatch } from './cloudwatch.normalizer';
import { normalizeGeneric, readPath } from './generic.normalizer';
import { UnsupportedPayloadError, normalizeGrafana } from './grafana.normalizer';
import { normalizePrometheus } from './prometheus.normalizer';
import { normalizeSentry } from './sentry.normalizer';

const now = new Date('2026-09-15T03:20:00Z');

describe('normalizePrometheus', () => {
  it('maps the PRD example payload', () => {
    const dto = plainToInstance(PrometheusWebhookDto, {
      version: '4',
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'HighCPU', service: 'auth-service', severity: 'critical' },
          annotations: { summary: 'CPU > 90% for 5 minutes' },
          startsAt: '2026-09-15T03:14:00Z',
          endsAt: '0001-01-01T00:00:00Z',
        },
      ],
    });
    const [alert] = normalizePrometheus(dto, now);
    expect(alert).toMatchObject({
      status: AlertStatus.FIRING,
      serviceName: 'auth-service',
      severity: IncidentSeverity.P1,
      title: 'HighCPU',
      description: 'CPU > 90% for 5 minutes',
      resolvedAt: null,
    });
    expect(alert.firedAt.toISOString()).toBe('2026-09-15T03:14:00.000Z');
  });

  it('maps warning → P2, anything else → P3, and parses resolution', () => {
    const dto = plainToInstance(PrometheusWebhookDto, {
      commonLabels: { job: 'billing' },
      alerts: [
        {
          status: 'resolved',
          labels: { alertname: 'A', severity: 'warning' },
          endsAt: '2026-09-15T03:19:00Z',
        },
        { status: 'firing', labels: { alertname: 'B', severity: 'info' } },
      ],
    });
    const [a, b] = normalizePrometheus(dto, now);
    expect(a.severity).toBe(IncidentSeverity.P2);
    expect(a.status).toBe(AlertStatus.RESOLVED);
    expect(a.resolvedAt?.toISOString()).toBe('2026-09-15T03:19:00.000Z');
    expect(a.serviceName).toBe('billing');
    expect(b.severity).toBe(IncidentSeverity.P3);
  });
});

describe('normalizeGrafana', () => {
  it('handles unified alerting (Alertmanager shape)', () => {
    const dto = plainToInstance(GrafanaWebhookDto, {
      alerts: [{ status: 'firing', labels: { alertname: 'Latency', service: 'api' } }],
    });
    expect(normalizeGrafana(dto, now)[0]).toMatchObject({ title: 'Latency', serviceName: 'api' });
  });

  it('handles legacy alerting/ok with evalMatches', () => {
    const firing = normalizeGrafana(
      plainToInstance(GrafanaWebhookDto, {
        state: 'alerting',
        ruleName: 'Error rate',
        tags: { service: 'checkout', severity: 'critical' },
        evalMatches: [{ metric: 'errors', value: 12 }],
      }),
      now,
    );
    expect(firing[0]).toMatchObject({
      status: AlertStatus.FIRING,
      serviceName: 'checkout',
      severity: IncidentSeverity.P1,
    });
    expect(firing[0].description).toContain('errors=12');

    const ok = normalizeGrafana(
      plainToInstance(GrafanaWebhookDto, { state: 'ok', ruleName: 'Error rate' }),
      now,
    );
    expect(ok[0].status).toBe(AlertStatus.RESOLVED);
  });

  it('ignores no_data/pending states and rejects unknown shapes', () => {
    expect(
      normalizeGrafana(
        plainToInstance(GrafanaWebhookDto, { state: 'no_data', ruleName: 'x' }),
        now,
      ),
    ).toEqual([]);
    expect(() => normalizeGrafana(plainToInstance(GrafanaWebhookDto, {}), now)).toThrow(
      UnsupportedPayloadError,
    );
  });
});

describe('normalizeSentry', () => {
  it('maps issue.created by level', () => {
    const [alert] = normalizeSentry(
      'issue',
      {
        action: 'created',
        data: {
          issue: {
            id: '1',
            title: 'TypeError: x is undefined',
            level: 'fatal',
            project: { slug: 'web-app' },
            firstSeen: '2026-09-15T03:10:00Z',
          },
        },
      },
      now,
    );
    expect(alert).toMatchObject({
      serviceName: 'web-app',
      severity: IncidentSeverity.P1,
      status: AlertStatus.FIRING,
      title: 'TypeError: x is undefined',
    });
  });

  it('maps issue.resolved and metric alerts', () => {
    const [resolved] = normalizeSentry(
      'issue',
      {
        action: 'resolved',
        data: { issue: { title: 'Boom', level: 'error', project: { slug: 'api' } } },
      },
      now,
    );
    expect(resolved.status).toBe(AlertStatus.RESOLVED);

    const [metric] = normalizeSentry(
      'metric_alert',
      {
        action: 'critical',
        data: { metric_alert: { alert_rule: { name: 'Error rate > 5%', projects: ['api'] } } },
      },
      now,
    );
    expect(metric).toMatchObject({ severity: IncidentSeverity.P1, serviceName: 'api' });
  });

  it('ignores non-alerting issue actions and rejects malformed data', () => {
    expect(normalizeSentry('issue', { action: 'assigned', data: {} }, now)).toEqual([]);
    expect(() => normalizeSentry('issue', { action: 'created', data: {} }, now)).toThrow(
      UnsupportedPayloadError,
    );
    expect(() => normalizeSentry('comment', { action: 'created', data: {} }, now)).toThrow(
      UnsupportedPayloadError,
    );
  });
});

describe('normalizeCloudWatch', () => {
  const alarm = {
    AlarmName: 'auth-service-high-cpu [P1]',
    NewStateValue: 'ALARM',
    NewStateReason: 'Threshold Crossed: 1 datapoint [94.0] was greater than 85.0',
    StateChangeTime: '2026-09-15T03:14:00.000+0000',
    Trigger: {
      MetricName: 'CPUUtilization',
      Namespace: 'AWS/ECS',
      Dimensions: [{ name: 'ServiceName', value: 'auth-service' }],
    },
  };

  it('maps ALARM → firing with dimension-derived service and name-marked severity', () => {
    const [alert] = normalizeCloudWatch(JSON.stringify(alarm), now);
    expect(alert).toMatchObject({
      status: AlertStatus.FIRING,
      serviceName: 'auth-service',
      severity: IncidentSeverity.P1,
    });
    expect(alert.description).toContain('Threshold Crossed');
  });

  it('maps OK → resolved and skips INSUFFICIENT_DATA', () => {
    expect(
      normalizeCloudWatch(JSON.stringify({ ...alarm, NewStateValue: 'OK' }), now)[0].status,
    ).toBe(AlertStatus.RESOLVED);
    expect(
      normalizeCloudWatch(JSON.stringify({ ...alarm, NewStateValue: 'INSUFFICIENT_DATA' }), now),
    ).toEqual([]);
    expect(() => normalizeCloudWatch('not json', now)).toThrow(UnsupportedPayloadError);
  });
});

describe('normalizeGeneric', () => {
  it('uses default field names', () => {
    const [alert] = normalizeGeneric(
      { title: 'Queue backlog', service: 'Worker', severity: 'warning', status: 'firing' },
      undefined,
      now,
    );
    expect(alert).toMatchObject({
      title: 'Queue backlog',
      serviceName: 'worker',
      severity: IncidentSeverity.P2,
    });
  });

  it('applies a tenant field mapping, severity map and resolved values', () => {
    const [alert] = normalizeGeneric(
      { event: { name: 'Disk full', host: 'db-1', prio: 'SEV0', state: 'CLEARED' } },
      {
        fieldMapping: {
          title: 'event.name',
          service: 'event.host',
          severity: 'event.prio',
          status: 'event.state',
        },
        severityMap: { SEV0: 'p1' },
        resolvedValues: ['cleared'],
      },
      now,
    );
    expect(alert).toMatchObject({
      serviceName: 'db-1',
      severity: IncidentSeverity.P1,
      status: AlertStatus.RESOLVED,
    });
  });

  it('requires a title and refuses prototype paths', () => {
    expect(() => normalizeGeneric({ service: 'x' }, undefined, now)).toThrow(
      UnsupportedPayloadError,
    );
    expect(readPath({ a: 1 }, '__proto__.polluted')).toBeUndefined();
  });
});
