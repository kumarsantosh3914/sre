import { AlertStatus, mapSeverity, normalizeServiceName } from '@sreai/shared';
import { AlertmanagerAlertDto, PrometheusWebhookDto } from '../dto/prometheus-webhook.dto';
import { RawAlert, parseDate, toStringRecord, truncate } from './raw-alert';

const SERVICE_LABELS = [
  'service',
  'service_name',
  'app',
  'application',
  'job',
  'container',
  'namespace',
];

export function serviceFromLabels(labels: Record<string, string>): string {
  for (const key of SERVICE_LABELS) {
    if (labels[key]) return normalizeServiceName(labels[key]);
  }
  return normalizeServiceName(undefined);
}

export function normalizeAlertmanagerAlert(
  alert: AlertmanagerAlertDto,
  commonLabels: Record<string, string>,
  commonAnnotations: Record<string, string>,
  now: Date,
): RawAlert {
  const labels = { ...toStringRecord(commonLabels), ...toStringRecord(alert.labels) };
  const annotations = {
    ...toStringRecord(commonAnnotations),
    ...toStringRecord(alert.annotations),
  };
  const status = alert.status === 'resolved' ? AlertStatus.RESOLVED : AlertStatus.FIRING;
  const firedAt = parseDate(alert.startsAt, now);

  return {
    status,
    serviceName: serviceFromLabels(labels),
    severity: mapSeverity(labels.severity ?? labels.priority),
    title: truncate(labels.alertname ?? annotations.summary, 500) ?? 'Unnamed alert',
    description: truncate(
      annotations.description ?? annotations.summary ?? annotations.message,
      5000,
    ),
    labels,
    firedAt,
    resolvedAt: status === AlertStatus.RESOLVED ? parseDate(alert.endsAt, now) : null,
    rawPayload: {
      status: alert.status,
      labels,
      annotations,
      startsAt: alert.startsAt,
      endsAt: alert.endsAt,
      generatorURL: alert.generatorURL,
      fingerprint: alert.fingerprint,
    },
  };
}

// One Alertmanager notification can carry many alerts (a group); each
// becomes its own RawAlert.
export function normalizePrometheus(dto: PrometheusWebhookDto, now: Date = new Date()): RawAlert[] {
  return dto.alerts.map((alert) =>
    normalizeAlertmanagerAlert(alert, dto.commonLabels ?? {}, dto.commonAnnotations ?? {}, now),
  );
}
