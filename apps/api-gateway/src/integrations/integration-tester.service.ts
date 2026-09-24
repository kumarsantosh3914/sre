import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { Integration } from '@sreai/database';
import {
  AlertSource,
  AlertStatus,
  IncidentSeverity,
  IntegrationType,
  computeAlertFingerprint,
  getTraceContext,
  newTraceId,
  safeFetch,
} from '@sreai/shared';
import { CommandBus } from '../common/command-bus.service';

export interface TestResult {
  ok: boolean;
  message: string;
  // Present when a synthetic alert was sent through the pipeline.
  testAlertId?: string;
}

export const TEST_SERVICE_NAME = 'sreai-test';

const ALERT_SOURCES: Partial<Record<IntegrationType, AlertSource>> = {
  [IntegrationType.PROMETHEUS]: AlertSource.PROMETHEUS,
  [IntegrationType.GRAFANA]: AlertSource.GRAFANA,
  [IntegrationType.SENTRY]: AlertSource.SENTRY,
  [IntegrationType.CLOUDWATCH]: AlertSource.CLOUDWATCH,
  [IntegrationType.GENERIC]: AlertSource.GENERIC,
};

function describe(err: unknown): string {
  const cause = (err as { cause?: { message?: string } })?.cause?.message;
  return err instanceof Error ? `${err.message}${cause ? ` (${cause})` : ''}` : String(err);
}

// "Test" button per integration: a live connectivity check where the
// integration allows one without side effects, and for alert sources a
// synthetic alert through the real pipeline (labelled sreai_test so it is
// diagnosed but never pages anyone or executes anything).
@Injectable()
export class IntegrationTesterService {
  private readonly slackApi = process.env.SLACK_API_URL ?? 'https://slack.com/api';
  private readonly githubApi = process.env.GITHUB_API_URL ?? 'https://api.github.com';

  constructor(private readonly commands: CommandBus) {}

  async test(
    tenantId: string,
    integration: Integration,
    credentials: Record<string, unknown>,
    platformSlackToken: string | undefined,
  ): Promise<TestResult> {
    const config = integration.config;
    try {
      const check = await this.connectivity(
        integration.type as IntegrationType,
        config,
        credentials,
        platformSlackToken,
      );
      if (!check.ok) return check;
      const source = ALERT_SOURCES[integration.type as IntegrationType];
      if (!source) return check;
      const testAlertId = await this.sendTestAlert(tenantId, source);
      return {
        ok: true,
        message: `${check.message} Test alert sent — watch it get diagnosed.`,
        testAlertId,
      };
    } catch (err) {
      return { ok: false, message: describe(err) };
    }
  }

  private async connectivity(
    type: IntegrationType,
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
    platformSlackToken: string | undefined,
  ): Promise<TestResult> {
    const bearer = (token: unknown): Record<string, string> =>
      typeof token === 'string' ? { authorization: `Bearer ${token}` } : {};

    switch (type) {
      case IntegrationType.PROMETHEUS: {
        const res = await safeFetch(
          new URL('/api/v1/query?query=up', String(config.url)).toString(),
          {
            headers: bearer(credentials.bearerToken),
            timeoutMs: 5_000,
          },
        );
        return res.ok
          ? { ok: true, message: 'Prometheus reachable.' }
          : { ok: false, message: `Prometheus returned HTTP ${res.status}` };
      }
      case IntegrationType.GRAFANA: {
        const res = await safeFetch(new URL('/api/health', String(config.url)).toString(), {
          headers: bearer(credentials.apiToken),
          timeoutMs: 5_000,
        });
        return res.ok
          ? { ok: true, message: 'Grafana reachable.' }
          : { ok: false, message: `Grafana returned HTTP ${res.status}` };
      }
      case IntegrationType.LOKI: {
        const res = await safeFetch(new URL('/ready', String(config.url)).toString(), {
          headers: bearer(credentials.bearerToken),
          timeoutMs: 5_000,
        });
        return res.ok
          ? { ok: true, message: 'Loki is ready.' }
          : { ok: false, message: `Loki returned HTTP ${res.status}` };
      }
      case IntegrationType.SLACK: {
        const token = (credentials.botToken as string | undefined) ?? platformSlackToken;
        if (!token)
          return {
            ok: false,
            message: 'No bot token configured and no platform Slack app available.',
          };
        const res = await fetch(`${this.slackApi}/chat.postMessage`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            channel: config.channel,
            text: ':white_check_mark: SRE.ai is connected to this channel.',
          }),
          signal: AbortSignal.timeout(5_000),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        return body.ok
          ? { ok: true, message: `Posted a test message to ${String(config.channel)}.` }
          : { ok: false, message: `Slack error: ${body.error ?? `HTTP ${res.status}`}` };
      }
      case IntegrationType.GITHUB: {
        const res = await fetch(`${this.githubApi}/user`, {
          headers: {
            ...bearer(credentials.token),
            accept: 'application/vnd.github+json',
            'user-agent': 'sre-ai',
          },
          signal: AbortSignal.timeout(5_000),
        });
        return res.ok
          ? { ok: true, message: 'GitHub token is valid.' }
          : { ok: false, message: `GitHub returned HTTP ${res.status}` };
      }
      case IntegrationType.AWS: {
        const sts = new STSClient({
          region: String(config.region),
          credentials: {
            accessKeyId: String(credentials.accessKeyId),
            secretAccessKey: String(credentials.secretAccessKey),
          },
        });
        const identity = await sts.send(new GetCallerIdentityCommand({}));
        return { ok: true, message: `Authenticated as ${identity.Arn ?? 'AWS principal'}.` };
      }
      case IntegrationType.PAGERDUTY:
        // Any PagerDuty event would page someone; verified on first escalation.
        return {
          ok: true,
          message: 'Routing key saved. PagerDuty is verified on the first real escalation.',
        };
      case IntegrationType.REDIS:
        return {
          ok: true,
          message: 'Saved. The Redis connection is verified before any cache flush runs.',
        };
      default:
        return { ok: true, message: 'Configuration saved.' };
    }
  }

  private async sendTestAlert(tenantId: string, source: AlertSource): Promise<string> {
    const alertId = randomUUID();
    const title = `SRE.ai test alert (${source}) ${alertId.slice(0, 8)}`;
    await this.commands.incident({
      kind: 'alert',
      traceId: getTraceContext()?.traceId ?? newTraceId(),
      alert: {
        alertId,
        tenantId,
        source,
        status: AlertStatus.FIRING,
        serviceName: TEST_SERVICE_NAME,
        severity: IncidentSeverity.P3,
        title,
        description:
          'Synthetic alert sent from the integrations page to verify the pipeline end to end.',
        labels: { alertname: 'SreaiTestAlert', service: TEST_SERVICE_NAME, sreai_test: 'true' },
        firedAt: new Date().toISOString(),
        resolvedAt: null,
        fingerprint: computeAlertFingerprint(tenantId, TEST_SERVICE_NAME, title),
        stormKey: null,
        isStormSummary: false,
        rawPayload: { synthetic: true },
      },
    });
    return alertId;
  }
}
