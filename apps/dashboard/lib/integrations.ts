// Catalogue of integration types the api-gateway accepts, with the form
// fields each needs. Mirrors IntegrationSchemas in @sreai/shared.

export type Group = 'alerts' | 'context' | 'notify';

export interface FieldDef {
  key: string;
  label: string;
  kind: 'config' | 'credential';
  type?: 'text' | 'url' | 'password';
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface IntegrationDef {
  type: string;
  name: string;
  group: Group;
  summary: string;
  fields: FieldDef[];
}

export const GROUPS: Record<Group, { title: string; description: string }> = {
  alerts: {
    title: 'Alert sources',
    description:
      'Where incidents come from. Each sends alerts to your webhook URL; SRE.ai deduplicates and diagnoses them.',
  },
  context: {
    title: 'Context',
    description:
      'What SRE.ai reads while diagnosing — and, for AWS and GitHub, what it can act on with your approval.',
  },
  notify: {
    title: 'Notifications',
    description: 'Where SRE.ai tells people what happened and asks for approval.',
  },
};

export const INTEGRATIONS: IntegrationDef[] = [
  {
    type: 'prometheus',
    name: 'Prometheus',
    group: 'alerts',
    summary: 'Alertmanager webhooks in; metric snapshots for diagnosis.',
    fields: [
      {
        key: 'url',
        label: 'Prometheus URL',
        kind: 'config',
        type: 'url',
        placeholder: 'https://prometheus.example.com',
        required: true,
        hint: 'Queried for metrics around each alert. Must be reachable from the internet.',
      },
      {
        key: 'bearerToken',
        label: 'Bearer token',
        kind: 'credential',
        type: 'password',
        hint: 'Optional, if your Prometheus requires auth.',
      },
    ],
  },
  {
    type: 'grafana',
    name: 'Grafana',
    group: 'alerts',
    summary: 'Unified and legacy alert webhooks; metrics through a Prometheus datasource.',
    fields: [
      {
        key: 'url',
        label: 'Grafana URL',
        kind: 'config',
        type: 'url',
        placeholder: 'https://grafana.example.com',
        required: true,
      },
      {
        key: 'datasourceUid',
        label: 'Prometheus datasource UID',
        kind: 'config',
        hint: 'Optional. Lets SRE.ai read metrics through Grafana when Prometheus isn’t public.',
      },
      {
        key: 'apiToken',
        label: 'Service account token',
        kind: 'credential',
        type: 'password',
        required: true,
      },
    ],
  },
  {
    type: 'sentry',
    name: 'Sentry',
    group: 'alerts',
    summary: 'Issue, error and metric alerts from an internal integration.',
    fields: [
      {
        key: 'clientSecret',
        label: 'Client secret',
        kind: 'credential',
        type: 'password',
        hint: 'From the internal integration; verifies every webhook signature.',
      },
    ],
  },
  {
    type: 'cloudwatch',
    name: 'CloudWatch',
    group: 'alerts',
    summary: 'CloudWatch alarms via an SNS HTTPS subscription (signatures verified).',
    fields: [],
  },
  {
    type: 'generic',
    name: 'Generic webhook',
    group: 'alerts',
    summary: 'Any JSON — map its fields to title, service, severity and status.',
    fields: [
      {
        key: 'fieldMapping.title',
        label: 'Title field',
        kind: 'config',
        placeholder: 'title',
        required: true,
        hint: 'Dot path into the JSON body, e.g. alert.name',
      },
      {
        key: 'fieldMapping.service',
        label: 'Service field',
        kind: 'config',
        placeholder: 'service',
        required: true,
      },
      {
        key: 'fieldMapping.severity',
        label: 'Severity field',
        kind: 'config',
        placeholder: 'severity',
      },
      { key: 'fieldMapping.status', label: 'Status field', kind: 'config', placeholder: 'status' },
      {
        key: 'fieldMapping.description',
        label: 'Description field',
        kind: 'config',
        placeholder: 'description',
      },
    ],
  },
  {
    type: 'loki',
    name: 'Loki',
    group: 'context',
    summary: 'Log lines around each alert (for services without a CloudWatch log group).',
    fields: [
      {
        key: 'url',
        label: 'Loki URL',
        kind: 'config',
        type: 'url',
        placeholder: 'https://logs.example.com',
        required: true,
      },
      {
        key: 'username',
        label: 'Username',
        kind: 'config',
        hint: 'For basic auth (Grafana Cloud: your instance id).',
      },
      { key: 'password', label: 'Password / API key', kind: 'credential', type: 'password' },
      {
        key: 'bearerToken',
        label: 'Bearer token',
        kind: 'credential',
        type: 'password',
        hint: 'Use instead of username + password.',
      },
    ],
  },
  {
    type: 'aws',
    name: 'AWS',
    group: 'context',
    summary: 'CloudWatch Logs for diagnosis; ECS restart and scale-out actions.',
    fields: [
      { key: 'region', label: 'Region', kind: 'config', placeholder: 'ap-south-1', required: true },
      { key: 'accessKeyId', label: 'Access key ID', kind: 'credential', required: true },
      {
        key: 'secretAccessKey',
        label: 'Secret access key',
        kind: 'credential',
        type: 'password',
        required: true,
        hint: 'Use an IAM user scoped to logs:FilterLogEvents, ecs:DescribeServices and ecs:UpdateService.',
      },
    ],
  },
  {
    type: 'github',
    name: 'GitHub',
    group: 'context',
    summary: 'Recent commits for deploy correlation; re-run deploy workflows.',
    fields: [
      {
        key: 'token',
        label: 'Access token',
        kind: 'credential',
        type: 'password',
        required: true,
        hint: 'Fine-grained token: contents read, actions write on the service repos.',
      },
    ],
  },
  {
    type: 'redis',
    name: 'Redis',
    group: 'context',
    summary: 'Flush an allowlisted cache key pattern when stale cache is the cause.',
    fields: [
      {
        key: 'url',
        label: 'Redis URL',
        kind: 'credential',
        type: 'password',
        required: true,
        placeholder: 'rediss://user:pass@host:6379',
      },
    ],
  },
  {
    type: 'slack',
    name: 'Slack',
    group: 'notify',
    summary: 'Incident threads, approvals with Approve / Reject / Roll back buttons.',
    fields: [
      {
        key: 'channel',
        label: 'Channel',
        kind: 'config',
        placeholder: '#incidents',
        required: true,
      },
      {
        key: 'teamId',
        label: 'Workspace ID',
        kind: 'config',
        placeholder: 'T0123ABC',
        hint: 'Optional. Only button clicks from this workspace are accepted.',
      },
      {
        key: 'botToken',
        label: 'Bot token',
        kind: 'credential',
        type: 'password',
        placeholder: 'xoxb-…',
        hint: 'Optional when your workspace uses the SRE.ai Slack app.',
      },
    ],
  },
  {
    type: 'pagerduty',
    name: 'PagerDuty',
    group: 'notify',
    summary: 'Pages on-call with the full context packet; resolves the page when SRE.ai resolves.',
    fields: [
      {
        key: 'routingKey',
        label: 'Events API v2 routing key',
        kind: 'credential',
        type: 'password',
        required: true,
      },
    ],
  },
];

export function defOf(type: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.type === type);
}

// Builds { config, credentials } from flat form values ("a.b" keys nest).
export function toPayload(def: IntegrationDef, values: Record<string, string>) {
  const config: Record<string, unknown> = {};
  const credentials: Record<string, unknown> = {};
  for (const field of def.fields) {
    const value = values[field.key]?.trim();
    if (!value) continue;
    const target = field.kind === 'config' ? config : credentials;
    const path = field.key.split('.');
    let node = target;
    for (const part of path.slice(0, -1)) {
      node[part] = (node[part] as Record<string, unknown> | undefined) ?? {};
      node = node[part] as Record<string, unknown>;
    }
    node[path[path.length - 1]] = value;
  }
  return { config, credentials };
}

export function flatConfig(config: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v))
      Object.assign(out, flatConfig(v as Record<string, unknown>, key));
    else if (v !== undefined && v !== null) out[key] = String(v);
  }
  return out;
}

// Copy-paste setup for each alert source. Header auth where the tool
// supports it (keeps the key out of access logs), path auth where it can't.
export function setupSnippet(
  source: string,
  base: string,
  key: string,
): { title: string; code: string; steps: string[] } | null {
  switch (source) {
    case 'prometheus':
      return {
        title: 'alertmanager.yml',
        steps: [
          'Add this receiver and route to your Alertmanager config.',
          'Reload Alertmanager. Firing and resolved alerts both flow in.',
        ],
        code: `route:
  receiver: sreai
  group_by: [alertname, service]

receivers:
  - name: sreai
    webhook_configs:
      - url: ${base}/prometheus
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials: ${key}`,
      };
    case 'grafana':
      return {
        title: 'Grafana contact point',
        steps: [
          'Alerting → Contact points → New contact point → Integration: Webhook.',
          `URL: ${base}/grafana`,
          'Optional settings → Authorization header: scheme Bearer, credentials = your API key.',
          'Attach the contact point to your notification policy.',
        ],
        code: `URL:          ${base}/grafana
Auth scheme:  Bearer
Credentials:  ${key}`,
      };
    case 'sentry':
      return {
        title: 'Sentry internal integration',
        steps: [
          'Settings → Developer Settings → Custom Integrations → New Internal Integration.',
          'Webhook URL: the URL below. Enable Alert Rule Action and the Issue webhook.',
          'Copy the Client Secret into this Sentry integration so every webhook is signature-checked.',
        ],
        code: `${base}/sentry/${key}`,
      };
    case 'cloudwatch':
      return {
        title: 'SNS subscription',
        steps: [
          'Create (or reuse) the SNS topic your CloudWatch alarms notify.',
          'Subscribe SRE.ai over HTTPS — it confirms the subscription automatically.',
        ],
        code: `aws sns subscribe \\
  --topic-arn arn:aws:sns:<region>:<account>:<topic> \\
  --protocol https \\
  --notification-endpoint ${base}/cloudwatch/${key}`,
      };
    case 'generic':
      return {
        title: 'Any tool that can POST JSON',
        steps: [
          'Send JSON with at least a title and a service. Map different field names on this integration.',
        ],
        code: `curl -X POST ${base}/generic \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Checkout latency high","service":"checkout","severity":"warning","status":"firing"}'`,
      };
    default:
      return null;
  }
}

export function webhookBase(webhookUrls: Record<string, string> | null): string {
  const sample = webhookUrls?.prometheus;
  if (!sample)
    return `${process.env.NEXT_PUBLIC_WEBHOOK_BASE_URL ?? 'https://<your-sreai-host>'}/webhooks`;
  return sample.replace(/\/prometheus\/[^/]+$/, '');
}
