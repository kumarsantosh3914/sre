import { Injectable, Logger } from '@nestjs/common';
import { COLLECTOR_TIMEOUT_MS, errorMeta } from '@sreai/shared';
import { TimeoutError, withTimeout } from '../../common/time';
import { DependencyCollector } from './collectors/dependency.collector';
import { DeployCollector, DeployExtra } from './collectors/deploy.collector';
import { LogCollector } from './collectors/log.collector';
import { MetricsCollector } from './collectors/metrics.collector';
import { SimilarExtra, SimilarIncidentCollector } from './collectors/similar-incident.collector';
import {
  Collector,
  CollectorInput,
  CollectorResult,
  ContextSection,
  ContextSource,
  DiagnosisContext,
  emptySection,
} from './context.types';

export interface CollectionReport {
  source: ContextSource;
  status: ContextSection['status'];
  lines: number;
  durationMs: number;
  note?: string;
}

// Fan-out: every collector runs concurrently with its own timeout, under
// Promise.allSettled (CLAUDE.md rule #5) — one integration being down
// degrades the context, it never kills the diagnosis.
@Injectable()
export class ContextCollectorService {
  private readonly logger = new Logger(ContextCollectorService.name);

  constructor(
    private readonly logs: LogCollector,
    private readonly metrics: MetricsCollector,
    private readonly deploy: DeployCollector,
    private readonly dependencies: DependencyCollector,
    private readonly similar: SimilarIncidentCollector,
  ) {}

  async collect(
    input: CollectorInput,
  ): Promise<{ context: DiagnosisContext; report: CollectionReport[] }> {
    const [logs, metrics, deploy, dependencies, similar] = await Promise.allSettled([
      this.run(this.logs, input),
      this.run(this.metrics, input),
      this.run<DeployExtra>(this.deploy, input),
      this.run(this.dependencies, input),
      this.run<SimilarExtra>(this.similar, input),
    ]);

    const settle = <T>(
      source: ContextSource,
      result: PromiseSettledResult<{ result: CollectorResult<T>; durationMs: number }>,
    ): { result: CollectorResult<T>; durationMs: number } => {
      if (result.status === 'fulfilled') return result.value;
      const reason = result.reason as unknown;
      const timedOut = reason instanceof TimeoutError;
      this.logger.warn('Context collector failed', {
        tenantId: input.incident.tenantId,
        incidentId: input.incident.id,
        collector: source,
        timedOut,
        ...errorMeta(reason),
      });
      return {
        result: {
          section: emptySection(
            source,
            timedOut ? 'timeout' : 'error',
            timedOut ? `collector timed out after ${COLLECTOR_TIMEOUT_MS}ms` : 'collector failed',
          ),
        },
        durationMs: 0,
      };
    };

    const l = settle('logs', logs);
    const m = settle('metrics', metrics);
    const d = settle<DeployExtra>('deploy', deploy);
    const h = settle('dependency', dependencies);
    const s = settle<SimilarExtra>('similar_incident', similar);

    const context: DiagnosisContext = {
      incident: input.incident,
      sections: {
        logs: l.result.section,
        metrics: m.result.section,
        deploy: d.result.section,
        dependency: h.result.section,
        similar_incident: s.result.section,
      },
      recentDeploy: d.result.extra?.recentDeploy ?? null,
      similarIncidents: s.result.extra?.similarIncidents ?? [],
      pattern: s.result.extra?.pattern ?? null,
    };

    const report: CollectionReport[] = [l, m, d, h, s].map(({ result, durationMs }) => ({
      source: result.section.source,
      status: result.section.status,
      lines: result.section.lines.length,
      durationMs,
      ...(result.section.note ? { note: result.section.note } : {}),
    }));

    this.logger.log('Context collected', {
      tenantId: input.incident.tenantId,
      incidentId: input.incident.id,
      sections: report.map((r) => `${r.source}:${r.status}:${r.lines}`).join(' '),
    });
    return { context, report };
  }

  private async run<T = undefined>(
    collector: Collector<T>,
    input: CollectorInput,
  ): Promise<{ result: CollectorResult<T>; durationMs: number }> {
    const started = Date.now();
    const result = await withTimeout(
      collector.collect(input),
      COLLECTOR_TIMEOUT_MS,
      collector.source,
    );
    return { result, durationMs: Date.now() - started };
  }
}
