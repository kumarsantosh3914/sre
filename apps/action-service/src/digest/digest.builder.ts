import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface DigestStats {
  windowStart: Date;
  windowEnd: Date;
  opened: { total: number; p1: number; p2: number; p3: number };
  resolved: number;
  autoExecuted: number;
  escalations: number;
  avgMttrSeconds: number | null;
  previousAvgMttrSeconds: number | null;
  openNow: number;
  topRecurring: { title: string; occurrences: number } | null;
}

const DAY_MS = 86_400_000;

// Last-24h summary (sent at 09:00 tenant time, so it covers "yesterday").
// Tenant-scoped queries only.
@Injectable()
export class DigestBuilder {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async build(tenantId: string, now: Date = new Date()): Promise<DigestStats> {
    const end = now;
    const start = new Date(end.getTime() - DAY_MS);
    const prevStart = new Date(start.getTime() - DAY_MS);

    const [opened, resolved, prevResolved, actions, open, recurring] = await Promise.all([
      this.ds.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE severity = 'p1')::int AS p1,
                count(*) FILTER (WHERE severity = 'p2')::int AS p2,
                count(*) FILTER (WHERE severity = 'p3')::int AS p3
           FROM incidents
          WHERE tenant_id = $1 AND detected_at >= $2 AND detected_at < $3 AND parent_incident_id IS NULL`,
        [tenantId, start, end],
      ),
      this.ds.query(
        `SELECT count(*)::int AS count, avg(mttr_seconds) AS avg
           FROM incidents
          WHERE tenant_id = $1 AND resolved_at >= $2 AND resolved_at < $3 AND parent_incident_id IS NULL`,
        [tenantId, start, end],
      ),
      this.ds.query(
        `SELECT avg(mttr_seconds) AS avg FROM incidents
          WHERE tenant_id = $1 AND resolved_at >= $2 AND resolved_at < $3 AND parent_incident_id IS NULL`,
        [tenantId, prevStart, start],
      ),
      this.ds.query(
        `SELECT count(*) FILTER (WHERE tier = 'auto' AND status IN ('executed', 'rolled_back'))::int AS auto,
                count(*) FILTER (WHERE action_type = 'escalate')::int AS escalations
           FROM actions WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
        [tenantId, start, end],
      ),
      this.ds.query(
        `SELECT count(*)::int AS count FROM incidents
          WHERE tenant_id = $1 AND status <> 'resolved' AND parent_incident_id IS NULL`,
        [tenantId],
      ),
      this.ds.query(
        `SELECT max(title) AS title, count(*)::int AS occurrences FROM incidents
          WHERE tenant_id = $1 AND detected_at >= $2 AND fingerprint IS NOT NULL AND parent_incident_id IS NULL
          GROUP BY fingerprint HAVING count(*) > 1 ORDER BY occurrences DESC LIMIT 1`,
        [tenantId, new Date(end.getTime() - 7 * DAY_MS)],
      ),
    ]);

    const avg = (v: unknown): number | null =>
      v === null || v === undefined ? null : Math.round(Number(v));
    return {
      windowStart: start,
      windowEnd: end,
      opened: { total: opened[0].total, p1: opened[0].p1, p2: opened[0].p2, p3: opened[0].p3 },
      resolved: resolved[0].count,
      autoExecuted: actions[0].auto,
      escalations: actions[0].escalations,
      avgMttrSeconds: avg(resolved[0].avg),
      previousAvgMttrSeconds: avg(prevResolved[0].avg),
      openNow: open[0].count,
      topRecurring: recurring[0]
        ? { title: recurring[0].title, occurrences: recurring[0].occurrences }
        : null,
    };
  }
}
