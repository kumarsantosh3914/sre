import {
  AlertStatus,
  IncidentSeverity,
  IntegrationConfig,
  IntegrationType,
  mapSeverity,
  normalizeServiceName,
} from '@sreai/shared';
import { UnsupportedPayloadError } from './grafana.normalizer';
import { RawAlert, parseDate, toStringRecord, truncate } from './raw-alert';

export type GenericConfig = IntegrationConfig<IntegrationType.GENERIC>;

// Used when the tenant hasn't configured a generic integration: accept the
// obvious field names.
export const DEFAULT_GENERIC_CONFIG: GenericConfig = {
  fieldMapping: {
    title: 'title',
    service: 'service',
    severity: 'severity',
    status: 'status',
    description: 'description',
  },
};

const DEFAULT_RESOLVED_VALUES = ['resolved', 'ok', 'closed', 'recovered'];
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function readPath(body: unknown, path: string): unknown {
  let current: unknown = body;
  for (const segment of path.split('.')) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current === null || typeof current !== 'object') return undefined;
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readString(body: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const value = readPath(body, path);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

// Any JSON, mapped to AlertDTO fields via the tenant's dot-path config.
export function normalizeGeneric(
  body: Record<string, unknown>,
  config: GenericConfig = DEFAULT_GENERIC_CONFIG,
  now: Date = new Date(),
): RawAlert[] {
  const { fieldMapping } = config;
  const title = readString(body, fieldMapping.title);
  if (!title) {
    throw new UnsupportedPayloadError(`Missing title at "${fieldMapping.title}"`);
  }

  const rawSeverity = readString(body, fieldMapping.severity);
  const mapped = rawSeverity ? config.severityMap?.[rawSeverity] : undefined;
  const severity: IncidentSeverity =
    Object.values(IncidentSeverity).find((s) => s === mapped) ?? mapSeverity(rawSeverity);

  const rawStatus = (readString(body, fieldMapping.status) ?? '').toLowerCase();
  const resolvedValues = (config.resolvedValues ?? DEFAULT_RESOLVED_VALUES).map((v) =>
    v.toLowerCase(),
  );
  const status = resolvedValues.includes(rawStatus) ? AlertStatus.RESOLVED : AlertStatus.FIRING;

  return [
    {
      status,
      serviceName: normalizeServiceName(readString(body, fieldMapping.service)),
      severity,
      title: truncate(title, 500) ?? title.slice(0, 500),
      description: truncate(readString(body, fieldMapping.description), 5000),
      labels: { alertname: title.slice(0, 200), ...toStringRecord(readPath(body, 'labels')) },
      firedAt: now,
      resolvedAt:
        status === AlertStatus.RESOLVED ? parseDate(readPath(body, 'resolvedAt'), now) : null,
      rawPayload: body,
    },
  ];
}
