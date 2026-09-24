import { Injectable } from '@nestjs/common';
import { BlockedAddressError, HEALTH_CHECK_TIMEOUT_MS, safeFetch } from '@sreai/shared';
import { Collector, CollectorInput, CollectorResult, emptySection } from '../context.types';
import { sanitizeLine } from '../sanitize';

export interface HealthResult {
  name: string;
  healthy: boolean;
  detail: string;
}

function describeError(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  if (err instanceof BlockedAddressError || cause instanceof BlockedAddressError) {
    return 'blocked: non-public address';
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`;
  }
  return 'connection failed';
}

// Pings the service's own health check and its declared dependencies in
// parallel (3s each). An unhealthy dependency is high-signal — often the
// actual root cause.
@Injectable()
export class DependencyCollector implements Collector {
  readonly source = 'dependency' as const;

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const { metadata, incident } = input;
    const targets = [
      ...(metadata.healthCheckUrl
        ? [{ name: `${incident.serviceName} (self)`, healthUrl: metadata.healthCheckUrl }]
        : []),
      ...(metadata.dependencies ?? []),
    ];
    if (targets.length === 0) {
      return {
        section: emptySection(
          'dependency',
          'not_configured',
          'no health checks or dependencies configured',
        ),
      };
    }

    const results = await Promise.all(targets.map((t) => this.check(t.name, t.healthUrl)));
    // Unhealthy first: they're what matters.
    results.sort((a, b) => Number(a.healthy) - Number(b.healthy));
    const lines = results.map((r) =>
      sanitizeLine(`${r.name}: ${r.healthy ? 'healthy' : 'unhealthy'} (${r.detail})`),
    );
    return { section: { source: 'dependency', status: 'ok', lines } };
  }

  async check(name: string, url: string): Promise<HealthResult> {
    const started = Date.now();
    try {
      const res = await safeFetch(url, { method: 'GET', timeoutMs: HEALTH_CHECK_TIMEOUT_MS });
      await res.body?.cancel();
      const ms = Date.now() - started;
      return { name, healthy: res.ok, detail: `HTTP ${res.status}, ${ms}ms` };
    } catch (err) {
      return { name, healthy: false, detail: describeError(err) };
    }
  }
}
