import { AlertStatus, IncidentSeverity } from '@sreai/shared';

// What a source normaliser produces: everything about the alert that can be
// derived from the payload alone. AlertIngestService adds the tenant,
// ids, fingerprint and storm grouping to make a NormalizedAlert.
export interface RawAlert {
  status: AlertStatus;
  serviceName: string;
  severity: IncidentSeverity;
  title: string;
  description: string | null;
  labels: Record<string, string>;
  firedAt: Date;
  resolvedAt: Date | null;
  rawPayload: Record<string, unknown>;
}

export function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k.slice(0, 100)] = (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 500);
  }
  return out;
}

export function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const d = new Date(value);
  // Alertmanager uses 0001-01-01T00:00:00Z for "not set".
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000) return fallback;
  return d;
}

export function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
