import { createHash } from 'crypto';
import { IncidentSeverity } from '../types';

const MAX_SERVICE_NAME = 100;
const UNKNOWN_SERVICE = 'unknown-service';

// Service names arrive from labels, Sentry project slugs, CloudWatch
// dimensions… Normalise so "Auth Service" and "auth-service" are the same
// service row.
export function normalizeServiceName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SERVICE_NAME);
  return cleaned || UNKNOWN_SERVICE;
}

// Strips volatile tokens so "Error rate 5.3% (req 8f3a…)" and "Error rate
// 6.1% (req 91bc…)" fingerprint identically, while "HighCPU" and
// "HighMemory" stay distinct.
export function normalizeTitleForFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

// SHA-256(tenantId | service | normalised title): the dedup key and the
// key a "resolved" notification uses to find the incident it closes.
export function computeAlertFingerprint(
  tenantId: string,
  serviceName: string,
  title: string,
): string {
  return createHash('sha256')
    .update(
      `${tenantId}|${normalizeServiceName(serviceName)}|${normalizeTitleForFingerprint(title)}`,
    )
    .digest('hex');
}

const P1_WORDS = new Set(['critical', 'crit', 'page', 'p1', 'sev1', 'sev-1', 'fatal', 'emergency']);
const P2_WORDS = new Set(['warning', 'warn', 'error', 'high', 'major', 'p2', 'sev2', 'sev-2']);

// Maps a free-form severity string to P1/P2/P3. Prometheus convention
// from the build guide: critical → P1, warning → P2, everything else → P3.
export function mapSeverity(raw: string | null | undefined): IncidentSeverity {
  const value = (raw ?? '').trim().toLowerCase();
  if (P1_WORDS.has(value)) return IncidentSeverity.P1;
  if (P2_WORDS.has(value)) return IncidentSeverity.P2;
  return IncidentSeverity.P3;
}

// Keeps an alert's raw payload inside the SQS message budget.
export function capRawPayload(
  payload: Record<string, unknown>,
  maxBytes: number,
): Record<string, unknown> {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
    return payload;
  }
  return { truncated: true, preview: serialized.slice(0, Math.min(10_000, maxBytes)) };
}
