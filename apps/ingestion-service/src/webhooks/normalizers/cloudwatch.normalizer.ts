import { AlertStatus, IncidentSeverity, normalizeServiceName } from '@sreai/shared';
import { z } from 'zod';
import { UnsupportedPayloadError } from './grafana.normalizer';
import { RawAlert, parseDate, truncate } from './raw-alert';

const AlarmSchema = z
  .object({
    AlarmName: z.string(),
    AlarmDescription: z.string().nullish(),
    NewStateValue: z.string(),
    NewStateReason: z.string().nullish(),
    StateChangeTime: z.string().nullish(),
    Region: z.string().nullish(),
    AWSAccountId: z.string().nullish(),
    Trigger: z
      .object({
        MetricName: z.string().nullish(),
        Namespace: z.string().nullish(),
        Dimensions: z
          .array(
            z.object({ name: z.string().optional(), value: z.string().optional() }).passthrough(),
          )
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type CloudWatchAlarm = z.infer<typeof AlarmSchema>;

const SERVICE_DIMENSIONS = [
  'ServiceName',
  'FunctionName',
  'DBInstanceIdentifier',
  'CacheClusterId',
  'LoadBalancer',
  'TargetGroup',
  'QueueName',
  'ClusterName',
  'AutoScalingGroupName',
  'InstanceId',
];

// CloudWatch has no severity field: honour an explicit marker in the alarm
// name/description ("[P1]", "critical"), default to P2.
function inferSeverity(alarm: CloudWatchAlarm): IncidentSeverity {
  const text = `${alarm.AlarmName} ${alarm.AlarmDescription ?? ''}`.toLowerCase();
  if (/\b(p1|sev1|critical)\b/.test(text)) return IncidentSeverity.P1;
  if (/\b(p3|sev3|low|info)\b/.test(text)) return IncidentSeverity.P3;
  return IncidentSeverity.P2;
}

function inferService(alarm: CloudWatchAlarm): string {
  const dims = alarm.Trigger?.Dimensions ?? [];
  for (const name of SERVICE_DIMENSIONS) {
    const match = dims.find((d) => d.name === name && d.value);
    if (match?.value) {
      // ECS/ALB dimension values can be paths ("app/my-alb/abc123").
      const parts = match.value.split('/');
      return normalizeServiceName(parts.length >= 2 ? parts[parts.length - 2] : match.value);
    }
  }
  return normalizeServiceName(alarm.AlarmName.split(/[\s:_]/)[0]);
}

// The alarm JSON carried in an SNS Notification's `Message` string.
export function normalizeCloudWatch(message: string, now: Date = new Date()): RawAlert[] {
  let alarm: CloudWatchAlarm;
  try {
    alarm = AlarmSchema.parse(JSON.parse(message));
  } catch {
    throw new UnsupportedPayloadError('SNS message is not a CloudWatch alarm');
  }

  // INSUFFICIENT_DATA is neither firing nor resolved.
  if (alarm.NewStateValue !== 'ALARM' && alarm.NewStateValue !== 'OK') {
    return [];
  }
  const status = alarm.NewStateValue === 'OK' ? AlertStatus.RESOLVED : AlertStatus.FIRING;
  const changedAt = parseDate(alarm.StateChangeTime, now);

  return [
    {
      status,
      serviceName: inferService(alarm),
      severity: inferSeverity(alarm),
      title: truncate(alarm.AlarmName, 500) ?? 'CloudWatch alarm',
      description: truncate(
        [alarm.AlarmDescription, alarm.NewStateReason].filter(Boolean).join('\n'),
        5000,
      ),
      labels: {
        alertname: alarm.AlarmName.slice(0, 200),
        metric: alarm.Trigger?.MetricName ?? '',
        namespace: alarm.Trigger?.Namespace ?? '',
        region: alarm.Region ?? '',
      },
      firedAt: changedAt,
      resolvedAt: status === AlertStatus.RESOLVED ? changedAt : null,
      rawPayload: alarm as Record<string, unknown>,
    },
  ];
}
