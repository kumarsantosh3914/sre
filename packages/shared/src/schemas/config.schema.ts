import { z } from 'zod';
import { IntegrationType } from '../types';

const httpUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'Must be an http(s) URL');

// ---- Per-service metadata (services.metadata) ----
// Drives enrichment, context collection and what actions are even possible
// for a service. Anything not configured here is skipped gracefully.
export const ServiceMetadataSchema = z
  .object({
    owner: z.string().max(200).optional(),
    repo: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Expected "owner/name"')
      .optional(),
    branch: z.string().max(200).optional(),
    runbookUrl: httpUrl.optional(),
    healthCheckUrl: httpUrl.optional(),
    dependencies: z
      .array(z.object({ name: z.string().min(1).max(100), healthUrl: httpUrl }))
      .max(20)
      .optional(),
    logGroup: z.string().max(512).optional(),
    lokiSelector: z.string().max(512).optional(),
    metricQueries: z.record(z.string().max(1000)).optional(),
    ecs: z
      .object({
        cluster: z.string().min(1).max(255),
        service: z.string().min(1).max(255),
        region: z.string().max(32).optional(),
        maxTasks: z.number().int().min(1).max(100).optional(),
      })
      .optional(),
    redeploy: z
      .object({
        workflow: z.string().min(1).max(255),
        ref: z.string().min(1).max(255).default('main'),
      })
      .optional(),
    // Allowlist — the only key patterns a FLUSH_CACHE action may ever touch.
    cacheFlushPatterns: z.array(z.string().min(3).max(200)).max(20).optional(),
  })
  .strict();

export type ServiceMetadata = z.infer<typeof ServiceMetadataSchema>;

// ---- Tenant settings (tenants.settings) ----

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

export const SilenceWindowSchema = z.object({
  // 0 = Sunday … 6 = Saturday, in the tenant's timezone.
  days: z.array(z.number().int().min(0).max(6)).min(1),
  start: hhmm,
  end: hhmm,
});

export const TenantSettingsSchema = z
  .object({
    timezone: z.string().min(1).max(64).default('UTC'),
    autoThreshold: z.number().min(0).max(1).nullable().default(null),
    draftThreshold: z.number().min(0).max(1).nullable().default(null),
    silenceWindows: z.array(SilenceWindowSchema).max(14).default([]),
    digestEnabled: z.boolean().default(true),
    digestRecipients: z.array(z.string().email()).max(20).default([]),
  })
  .strict();

export type SilenceWindow = z.infer<typeof SilenceWindowSchema>;
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

export function parseTenantSettings(raw: unknown): TenantSettings {
  const parsed = TenantSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : TenantSettingsSchema.parse({});
}

// ---- Integrations: non-secret config + encrypted credentials ----

const empty = z.object({}).strict();

export const IntegrationSchemas = {
  [IntegrationType.PROMETHEUS]: {
    config: z.object({ url: httpUrl }).strict(),
    credentials: z.object({ bearerToken: z.string().min(1).optional() }).strict(),
  },
  [IntegrationType.GRAFANA]: {
    // datasourceUid lets metrics collection query a Prometheus datasource
    // through Grafana's proxy when there's no direct Prometheus access.
    config: z
      .object({ url: httpUrl, datasourceUid: z.string().min(1).max(100).optional() })
      .strict(),
    credentials: z.object({ apiToken: z.string().min(1) }).strict(),
  },
  [IntegrationType.SENTRY]: {
    config: empty,
    credentials: z.object({ clientSecret: z.string().min(1).optional() }).strict(),
  },
  [IntegrationType.CLOUDWATCH]: {
    config: empty,
    credentials: empty,
  },
  [IntegrationType.GENERIC]: {
    // Dot-paths into the incoming JSON for each AlertDTO field.
    config: z
      .object({
        fieldMapping: z
          .object({
            title: z.string().min(1).max(200),
            service: z.string().min(1).max(200),
            severity: z.string().min(1).max(200).optional(),
            status: z.string().min(1).max(200).optional(),
            description: z.string().min(1).max(200).optional(),
          })
          .strict(),
        severityMap: z.record(z.enum(['p1', 'p2', 'p3'])).optional(),
        resolvedValues: z.array(z.string().max(50)).max(10).optional(),
      })
      .strict(),
    credentials: empty,
  },
  [IntegrationType.LOKI]: {
    config: z.object({ url: httpUrl, username: z.string().max(200).optional() }).strict(),
    credentials: z
      .object({ password: z.string().min(1).optional(), bearerToken: z.string().min(1).optional() })
      .strict(),
  },
  [IntegrationType.AWS]: {
    config: z.object({ region: z.string().min(1).max(32) }).strict(),
    credentials: z
      .object({ accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1) })
      .strict(),
  },
  [IntegrationType.GITHUB]: {
    config: z.object({ draftPrEnabled: z.boolean().default(false) }).strict(),
    credentials: z.object({ token: z.string().min(1) }).strict(),
  },
  [IntegrationType.SLACK]: {
    config: z
      .object({
        channel: z.string().min(1).max(100),
        // Slack workspace id; interactions from any other workspace are
        // rejected for this tenant.
        teamId: z.string().max(32).optional(),
      })
      .strict(),
    // Optional: falls back to the platform SLACK_BOT_TOKEN.
    credentials: z.object({ botToken: z.string().min(1).optional() }).strict(),
  },
  [IntegrationType.PAGERDUTY]: {
    config: empty,
    credentials: z.object({ routingKey: z.string().min(1) }).strict(),
  },
  [IntegrationType.REDIS]: {
    config: empty,
    credentials: z.object({ url: z.string().min(1) }).strict(),
  },
} as const;

export type IntegrationConfig<T extends IntegrationType> = z.infer<
  (typeof IntegrationSchemas)[T]['config']
>;
export type IntegrationCredentials<T extends IntegrationType> = z.infer<
  (typeof IntegrationSchemas)[T]['credentials']
>;
