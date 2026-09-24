import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface AnalyticsOverview {
  windowDays: number;
  totals: {
    incidents: number;
    open: number;
    resolved: number;
    escalated: number;
    avgMttrSeconds: number | null;
  };
  mttrByService: {
    service: string;
    incidents: number;
    avgMttrSeconds: number;
    medianMttrSeconds: number;
  }[];
  mttrTrend: { day: string; avgMttrSeconds: number; resolved: number }[];
  incidentsBySeverity: { day: string; p1: number; p2: number; p3: number }[];
  autoResolve: { rate: number | null; autoResolved: number; resolved: number };
  topRecurring: {
    title: string;
    service: string | null;
    occurrences: number;
    avgMttrSeconds: number | null;
  }[];
  confidenceDistribution: { bucket: string; count: number }[];
  tierCounts: { tier: string; count: number }[];
  citationPassRate: number | null;
}

function num(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Math.round(Number(v));
}

// Dashboard analytics (build guide Day 31-32). Every statement is
// parameterised and filtered by tenant_id; storm-grouped child incidents
// are excluded so a storm counts once.
@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async overview(tenantId: string, days: number): Promise<AnalyticsOverview> {
    const since = new Date(Date.now() - days * 86_400_000);
    const p = [tenantId, since];
    const base = `FROM incidents i WHERE i.tenant_id = $1 AND i.detected_at >= $2 AND i.parent_incident_id IS NULL`;

    const [
      totals,
      byService,
      trend,
      bySeverity,
      autoResolve,
      recurring,
      confidence,
      tiers,
      citations,
    ] = await Promise.all([
      this.ds.query(
        `SELECT count(*)::int AS incidents,
                  count(*) FILTER (WHERE i.status <> 'resolved')::int AS open,
                  count(*) FILTER (WHERE i.status = 'resolved')::int AS resolved,
                  count(*) FILTER (WHERE i.status = 'escalated')::int AS escalated,
                  avg(i.mttr_seconds) AS avg_mttr
           ${base}`,
        p,
      ),
      this.mttrByService(tenantId, since),
      this.mttrTrend(tenantId, since),
      this.ds.query(
        `SELECT to_char(date_trunc('day', i.detected_at), 'YYYY-MM-DD') AS day,
                  count(*) FILTER (WHERE i.severity = 'p1')::int AS p1,
                  count(*) FILTER (WHERE i.severity = 'p2')::int AS p2,
                  count(*) FILTER (WHERE i.severity = 'p3')::int AS p3
           ${base}
           GROUP BY 1 ORDER BY 1`,
        p,
      ),
      // Auto-resolved: resolved, an auto-tier action executed (and was not
      // rolled back), and no human approved/requested anything.
      this.ds.query(
        `SELECT count(*)::int AS resolved,
                  count(*) FILTER (WHERE EXISTS (
                      SELECT 1 FROM actions a
                       WHERE a.tenant_id = i.tenant_id AND a.incident_id = i.id
                         AND a.tier = 'auto' AND a.status = 'executed')
                    AND NOT EXISTS (
                      SELECT 1 FROM actions h
                       WHERE h.tenant_id = i.tenant_id AND h.incident_id = i.id
                         AND (h.decided_by IS NOT NULL OR h.requested_by LIKE 'user:%' OR h.requested_by LIKE 'slack:%'))
                    AND i.resolved_by IS NULL)::int AS auto_resolved
           ${base} AND i.status = 'resolved'`,
        p,
      ),
      this.ds.query(
        `SELECT max(i.title) AS title, max(s.name) AS service, count(*)::int AS occurrences,
                  avg(i.mttr_seconds) AS avg_mttr
             FROM incidents i LEFT JOIN services s ON s.id = i.service_id AND s.tenant_id = i.tenant_id
            WHERE i.tenant_id = $1 AND i.detected_at >= $2 AND i.parent_incident_id IS NULL
              AND i.fingerprint IS NOT NULL
            GROUP BY i.fingerprint
           HAVING count(*) > 1
            ORDER BY occurrences DESC
            LIMIT 5`,
        p,
      ),
      this.ds.query(
        `SELECT width_bucket(d.confidence, 0, 1.0000001, 10) AS bucket, count(*)::int AS count
             FROM diagnoses d
            WHERE d.tenant_id = $1 AND d.created_at >= $2
            GROUP BY 1 ORDER BY 1`,
        p,
      ),
      this.ds.query(
        `SELECT d.action_tier AS tier, count(*)::int AS count
             FROM diagnoses d WHERE d.tenant_id = $1 AND d.created_at >= $2
            GROUP BY 1`,
        p,
      ),
      this.ds.query(
        `SELECT avg(CASE WHEN d.citations_passed THEN 1 ELSE 0 END) AS rate
             FROM diagnoses d WHERE d.tenant_id = $1 AND d.created_at >= $2`,
        p,
      ),
    ]);

    const t = totals[0] ?? {};
    const ar = autoResolve[0] ?? { resolved: 0, auto_resolved: 0 };
    const buckets = new Map<number, number>(
      (confidence as { bucket: number; count: number }[]).map((r) => [Number(r.bucket), r.count]),
    );

    return {
      windowDays: days,
      totals: {
        incidents: num(t.incidents),
        open: num(t.open),
        resolved: num(t.resolved),
        escalated: num(t.escalated),
        avgMttrSeconds: numOrNull(t.avg_mttr),
      },
      mttrByService: byService,
      mttrTrend: trend,
      incidentsBySeverity: bySeverity as AnalyticsOverview['incidentsBySeverity'],
      autoResolve: {
        rate: num(ar.resolved) ? num(ar.auto_resolved) / num(ar.resolved) : null,
        autoResolved: num(ar.auto_resolved),
        resolved: num(ar.resolved),
      },
      topRecurring: (
        recurring as {
          title: string;
          service: string | null;
          occurrences: number;
          avg_mttr: unknown;
        }[]
      ).map((r) => ({
        title: r.title,
        service: r.service,
        occurrences: r.occurrences,
        avgMttrSeconds: numOrNull(r.avg_mttr),
      })),
      confidenceDistribution: Array.from({ length: 10 }, (_, i) => ({
        bucket: `${i * 10}-${i * 10 + 10}%`,
        count: buckets.get(i + 1) ?? 0,
      })),
      tierCounts: tiers as AnalyticsOverview['tierCounts'],
      citationPassRate:
        citations[0]?.rate === null || citations[0]?.rate === undefined
          ? null
          : Number(citations[0].rate),
    };
  }

  async mttrByService(tenantId: string, since: Date): Promise<AnalyticsOverview['mttrByService']> {
    const rows: { service: string; incidents: number; avg: unknown; median: unknown }[] =
      await this.ds.query(
        `SELECT coalesce(s.name, 'unknown') AS service, count(*)::int AS incidents,
              avg(i.mttr_seconds) AS avg,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY i.mttr_seconds) AS median
         FROM incidents i LEFT JOIN services s ON s.id = i.service_id AND s.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1 AND i.detected_at >= $2 AND i.status = 'resolved'
          AND i.mttr_seconds IS NOT NULL AND i.parent_incident_id IS NULL
        GROUP BY 1 ORDER BY avg DESC`,
        [tenantId, since],
      );
    return rows.map((r) => ({
      service: r.service,
      incidents: r.incidents,
      avgMttrSeconds: Math.round(Number(r.avg)),
      medianMttrSeconds: Math.round(Number(r.median)),
    }));
  }

  async mttrTrend(tenantId: string, since: Date): Promise<AnalyticsOverview['mttrTrend']> {
    const rows: { day: string; avg: unknown; resolved: number }[] = await this.ds.query(
      `SELECT to_char(date_trunc('day', i.resolved_at), 'YYYY-MM-DD') AS day,
              avg(i.mttr_seconds) AS avg, count(*)::int AS resolved
         FROM incidents i
        WHERE i.tenant_id = $1 AND i.resolved_at >= $2 AND i.mttr_seconds IS NOT NULL
          AND i.parent_incident_id IS NULL
        GROUP BY 1 ORDER BY 1`,
      [tenantId, since],
    );
    return rows.map((r) => ({
      day: r.day,
      avgMttrSeconds: Math.round(Number(r.avg)),
      resolved: r.resolved,
    }));
  }
}
