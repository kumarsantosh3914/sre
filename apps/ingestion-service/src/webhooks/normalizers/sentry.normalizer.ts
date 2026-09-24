import { AlertStatus, IncidentSeverity, mapSeverity, normalizeServiceName } from '@sreai/shared';
import { z } from 'zod';
import { SentryWebhookDto } from '../dto/sentry-webhook.dto';
import { UnsupportedPayloadError } from './grafana.normalizer';
import { RawAlert, parseDate, truncate } from './raw-alert';

const IssueSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string(),
    culprit: z.string().nullish(),
    level: z.string().nullish(),
    shortId: z.string().nullish(),
    permalink: z.string().nullish(),
    count: z.union([z.string(), z.number()]).nullish(),
    firstSeen: z.string().nullish(),
    project: z
      .object({ slug: z.string().nullish(), name: z.string().nullish() })
      .partial()
      .nullish(),
  })
  .passthrough();

const EventSchema = z
  .object({
    title: z.string(),
    level: z.string().nullish(),
    culprit: z.string().nullish(),
    web_url: z.string().nullish(),
    datetime: z.string().nullish(),
    project: z.union([z.string(), z.number()]).nullish(),
    tags: z.array(z.tuple([z.string(), z.string()])).nullish(),
  })
  .passthrough();

const MetricAlertSchema = z
  .object({
    title: z.string().nullish(),
    date_started: z.string().nullish(),
    date_closed: z.string().nullish(),
    alert_rule: z
      .object({ name: z.string().nullish(), projects: z.array(z.string()).nullish() })
      .partial()
      .nullish(),
  })
  .passthrough();

// Sentry's "error rate" signal: level fatal → P1, error → P2, else P3.
function levelToSeverity(level: string | null | undefined): IncidentSeverity {
  if (level === 'fatal') return IncidentSeverity.P1;
  if (level === 'error') return IncidentSeverity.P2;
  return IncidentSeverity.P3;
}

function fromIssue(dto: SentryWebhookDto, now: Date): RawAlert[] {
  if (!['created', 'resolved', 'unresolved'].includes(dto.action)) return [];
  const issue = IssueSchema.parse(dto.data.issue);
  const status = dto.action === 'resolved' ? AlertStatus.RESOLVED : AlertStatus.FIRING;
  return [
    {
      status,
      serviceName: normalizeServiceName(issue.project?.slug ?? issue.project?.name),
      severity: levelToSeverity(issue.level),
      title: truncate(issue.title, 500) ?? 'Sentry issue',
      description: truncate(
        [issue.culprit, issue.count ? `Events: ${issue.count}` : null, issue.permalink]
          .filter(Boolean)
          .join('\n'),
        5000,
      ),
      labels: {
        alertname: issue.title.slice(0, 200),
        sentry_issue: String(issue.shortId ?? issue.id ?? ''),
        level: issue.level ?? 'unknown',
      },
      firedAt: parseDate(issue.firstSeen, now),
      resolvedAt: status === AlertStatus.RESOLVED ? now : null,
      rawPayload: { resource: 'issue', action: dto.action, issue },
    },
  ];
}

function fromEvent(dto: SentryWebhookDto, now: Date, key: 'event' | 'error'): RawAlert[] {
  const event = EventSchema.parse(dto.data[key]);
  const tags = Object.fromEntries(event.tags ?? []);
  return [
    {
      status: AlertStatus.FIRING,
      serviceName: normalizeServiceName(tags.service ?? String(event.project ?? '')),
      severity: levelToSeverity(event.level),
      title: truncate(event.title, 500) ?? 'Sentry event',
      description: truncate([event.culprit, event.web_url].filter(Boolean).join('\n'), 5000),
      labels: { alertname: event.title.slice(0, 200), level: event.level ?? 'unknown' },
      firedAt: parseDate(event.datetime, now),
      resolvedAt: null,
      rawPayload: { resource: key, action: dto.action, event },
    },
  ];
}

function fromMetricAlert(dto: SentryWebhookDto, now: Date): RawAlert[] {
  const alert = MetricAlertSchema.parse(dto.data.metric_alert);
  const name = alert.alert_rule?.name ?? alert.title ?? 'Sentry metric alert';
  const status = dto.action === 'resolved' ? AlertStatus.RESOLVED : AlertStatus.FIRING;
  const description =
    typeof dto.data.description_text === 'string' ? dto.data.description_text : null;
  return [
    {
      status,
      serviceName: normalizeServiceName(alert.alert_rule?.projects?.[0]),
      // Metric alert actions are the severity: critical | warning | resolved.
      severity: mapSeverity(dto.action === 'resolved' ? 'info' : dto.action),
      title: truncate(name, 500) ?? 'Sentry metric alert',
      description: truncate(description, 5000),
      labels: { alertname: name.slice(0, 200) },
      firedAt: parseDate(alert.date_started, now),
      resolvedAt: status === AlertStatus.RESOLVED ? parseDate(alert.date_closed, now) : null,
      rawPayload: { resource: 'metric_alert', action: dto.action, metricAlert: alert },
    },
  ];
}

export function normalizeSentry(
  resource: string | undefined,
  dto: SentryWebhookDto,
  now: Date = new Date(),
): RawAlert[] {
  try {
    switch (resource) {
      case 'issue':
        return fromIssue(dto, now);
      case 'event_alert':
        return fromEvent(dto, now, 'event');
      case 'error':
        return fromEvent(dto, now, 'error');
      case 'metric_alert':
        return fromMetricAlert(dto, now);
      case 'installation':
        return [];
      default:
        throw new UnsupportedPayloadError(`Unsupported Sentry resource "${resource ?? ''}"`);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new UnsupportedPayloadError(`Malformed Sentry ${resource} payload`);
    }
    throw err;
  }
}
