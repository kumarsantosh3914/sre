import { Inject, Injectable } from '@nestjs/common';
import { IntegrationReader } from '@sreai/database';
import { IntegrationType, METRICS_WINDOW_MINUTES, safeFetch } from '@sreai/shared';
import { hhmmUtc } from '../../../common/time';
import { INTEGRATION_READER } from '../../../common/tokens';
import { Collector, CollectorInput, CollectorResult, emptySection } from '../context.types';
import { sanitizeLine } from '../sanitize';

const STEP_SECONDS = 60;
const MAX_SERIES_PER_QUERY = 3;
const BASELINE_GAP_MS = 5 * 60_000;

// Conventional names for a service labelled `service="<name>"`; override
// per service with metadata.metricQueries.
export function defaultMetricQueries(service: string): Record<string, string> {
  const sel = `service="${service}"`;
  return {
    error_rate: `sum(rate(http_requests_total{${sel},status=~"5.."}[5m])) / sum(rate(http_requests_total{${sel}}[5m]))`,
    latency_p95_seconds: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{${sel}}[5m])) by (le))`,
    request_rate: `sum(rate(http_requests_total{${sel}}[5m]))`,
    cpu_cores: `sum(rate(process_cpu_seconds_total{${sel}}[5m]))`,
    memory_bytes: `sum(process_resident_memory_bytes{${sel}})`,
  };
}

interface Series {
  metric: Record<string, string>;
  values: [number, string][];
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toPrecision(3)}G`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toPrecision(3)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toPrecision(3)}k`;
  return Number(n.toPrecision(3)).toString();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// "cpu_cores: peak 0.94 at 03:12 UTC; baseline 0.301; latest 0.912 (3.1x baseline)"
export function summarizeSeries(name: string, series: Series, alertAt: Date): string | null {
  const points = series.values
    .map(([ts, v]) => ({ at: new Date(ts * 1000), value: Number(v) }))
    .filter((p) => Number.isFinite(p.value));
  if (points.length === 0) return null;

  const peak = points.reduce((max, p) => (p.value > max.value ? p : max), points[0]);
  const latest = points[points.length - 1];
  const baseline = median(
    points.filter((p) => p.at.getTime() < alertAt.getTime() - BASELINE_GAP_MS).map((p) => p.value),
  );
  const labels = Object.entries(series.metric)
    .filter(([k]) => k !== '__name__')
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');

  let line = `${name}: peak ${fmt(peak.value)} at ${hhmmUtc(peak.at)}; `;
  line += baseline === null ? 'baseline n/a; ' : `baseline ${fmt(baseline)}; `;
  line += `latest ${fmt(latest.value)}`;
  if (baseline !== null && baseline > 0 && peak.value / baseline >= 1.5) {
    line += ` (${(peak.value / baseline).toFixed(1)}x baseline)`;
  }
  if (labels) line += ` {${labels}}`;
  return sanitizeLine(line);
}

interface PromTarget {
  baseUrl: string;
  headers: Record<string, string>;
}

// Prometheus query_range over the 30 minutes before the alert, one
// summary line per series. Uses Prometheus directly, or a Prometheus
// datasource through Grafana's proxy as a fallback.
@Injectable()
export class MetricsCollector implements Collector {
  readonly source = 'metrics' as const;

  constructor(@Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader) {}

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const { incident, metadata } = input;
    const target = await this.resolveTarget(incident.tenantId);
    if (!target) {
      return {
        section: emptySection('metrics', 'not_configured', 'no Prometheus or Grafana integration'),
      };
    }

    const queries = metadata.metricQueries ?? defaultMetricQueries(incident.serviceName);
    const end = new Date(Math.min(Date.now(), incident.detectedAt.getTime() + 2 * 60_000));
    const start = new Date(incident.detectedAt.getTime() - METRICS_WINDOW_MINUTES * 60_000);

    const results = await Promise.allSettled(
      Object.entries(queries).map(async ([name, promql]) => {
        const series = await this.queryRange(target, promql, start, end);
        return series
          .slice(0, MAX_SERIES_PER_QUERY)
          .map((s) => summarizeSeries(name, s, incident.detectedAt))
          .filter((l): l is string => l !== null);
      }),
    );

    const lines = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (lines.length === 0) {
      return {
        section: emptySection(
          'metrics',
          failures === results.length ? 'error' : 'empty',
          failures
            ? `${failures}/${results.length} metric queries failed`
            : 'queries returned no data',
        ),
      };
    }
    return {
      section: {
        source: 'metrics',
        status: 'ok',
        lines,
        ...(failures ? { note: `${failures} metric queries failed` } : {}),
      },
    };
  }

  private async resolveTarget(tenantId: string): Promise<PromTarget | null> {
    const prometheus = await this.integrations.get(tenantId, IntegrationType.PROMETHEUS);
    if (prometheus) {
      return {
        baseUrl: prometheus.config.url,
        headers: prometheus.credentials.bearerToken
          ? { authorization: `Bearer ${prometheus.credentials.bearerToken}` }
          : {},
      };
    }
    const grafana = await this.integrations.get(tenantId, IntegrationType.GRAFANA);
    if (grafana?.config.datasourceUid) {
      return {
        baseUrl: new URL(
          `/api/datasources/proxy/uid/${encodeURIComponent(grafana.config.datasourceUid)}/`,
          grafana.config.url,
        ).toString(),
        headers: { authorization: `Bearer ${grafana.credentials.apiToken}` },
      };
    }
    return null;
  }

  private async queryRange(
    target: PromTarget,
    query: string,
    start: Date,
    end: Date,
  ): Promise<Series[]> {
    const url = new URL(
      'api/v1/query_range',
      target.baseUrl.endsWith('/') ? target.baseUrl : `${target.baseUrl}/`,
    );
    url.searchParams.set('query', query);
    url.searchParams.set('start', String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set('end', String(Math.floor(end.getTime() / 1000)));
    url.searchParams.set('step', String(STEP_SECONDS));
    const res = await safeFetch(url.toString(), { headers: target.headers, timeoutMs: 8_000 });
    if (!res.ok) throw new Error(`Prometheus query failed: HTTP ${res.status}`);
    const body = (await res.json()) as { status?: string; data?: { result?: Series[] } };
    if (body.status !== 'success') throw new Error('Prometheus query returned an error');
    return body.data?.result ?? [];
  }
}
