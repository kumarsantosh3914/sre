import { AlertStatus, mapSeverity, normalizeServiceName } from '@sreai/shared';
import { GrafanaWebhookDto } from '../dto/grafana-webhook.dto';
import { normalizeAlertmanagerAlert } from './prometheus.normalizer';
import { RawAlert, toStringRecord, truncate } from './raw-alert';

export class UnsupportedPayloadError extends Error {}

// Grafana 8+ unified alerting reuses the Alertmanager format; the legacy
// dashboard-alert format is state + ruleName + evalMatches.
export function normalizeGrafana(dto: GrafanaWebhookDto, now: Date = new Date()): RawAlert[] {
  if (dto.alerts && dto.alerts.length > 0) {
    return dto.alerts.map((alert) => normalizeAlertmanagerAlert(alert, {}, {}, now));
  }

  if (!dto.state || !dto.ruleName) {
    throw new UnsupportedPayloadError('Grafana payload has neither alerts[] nor state/ruleName');
  }
  // Legacy states: alerting | ok | no_data | paused | pending.
  if (dto.state !== 'alerting' && dto.state !== 'ok') {
    return [];
  }

  const tags = toStringRecord(dto.tags);
  const matches = (dto.evalMatches ?? []).map((m) => `${m.metric ?? 'value'}=${m.value ?? 'n/a'}`);
  const status = dto.state === 'ok' ? AlertStatus.RESOLVED : AlertStatus.FIRING;
  const description = [dto.message, matches.length ? `Eval matches: ${matches.join(', ')}` : null]
    .filter(Boolean)
    .join('\n');

  return [
    {
      status,
      serviceName: normalizeServiceName(tags.service ?? tags.app ?? dto.ruleName),
      severity: mapSeverity(tags.severity),
      title: truncate(dto.ruleName, 500) ?? 'Grafana alert',
      description: truncate(description, 5000),
      labels: { ...tags, alertname: dto.ruleName },
      firedAt: now,
      resolvedAt: status === AlertStatus.RESOLVED ? now : null,
      rawPayload: {
        state: dto.state,
        ruleName: dto.ruleName,
        ruleId: dto.ruleId,
        ruleUrl: dto.ruleUrl,
        message: dto.message,
        tags,
        evalMatches: dto.evalMatches ?? [],
      },
    },
  ];
}
