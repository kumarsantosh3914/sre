import type { ActionType, EvidenceSource, IncidentStatus, Severity, Tier } from './types';

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  detecting: 'Detecting',
  diagnosing: 'Diagnosing',
  acting: 'Acting',
  resolved: 'Resolved',
  escalated: 'Escalated',
};

export const SEVERITY_LABEL: Record<Severity, string> = { p1: 'P1', p2: 'P2', p3: 'P3' };

export const TIER_LABEL: Record<Tier, string> = {
  auto: 'Auto-execute',
  draft: 'Needs approval',
  escalate: 'Escalate',
};

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  logs: 'Logs',
  metrics: 'Metrics',
  deploy: 'Deploy',
  dependency: 'Dependency',
  similar_incident: 'Past incident',
};

export const ACTION_LABEL: Record<ActionType, string> = {
  restart_service: 'Restart service',
  scale_service: 'Scale out',
  flush_cache: 'Flush cache',
  redeploy: 'Redeploy',
  notify: 'Notify',
  escalate: 'Escalate',
  rollback: 'Roll back',
};

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${String(seconds % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function stamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

// "SH-4F2A" — the drawing sheet number for an incident (first 4 hex of id).
export function sheetNo(id: string): string {
  return `SH-${id.slice(0, 4).toUpperCase()}`;
}

// "user:<id>" → the teammate's email when known (names: id → email).
export function actor(by: string | null | undefined, names: Record<string, string> = {}): string {
  if (!by || by === 'system') return 'SRE.ai';
  const [kind, id] = by.split(':');
  if (kind === 'slack') return `Slack ${id ?? ''}`.trim();
  if (kind === 'user') return (id && names[id]) || 'Teammate';
  return by;
}
