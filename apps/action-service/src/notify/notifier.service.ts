import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationReader } from '@sreai/database';
import { IntegrationType, errorMeta } from '@sreai/shared';
import { INTEGRATION_READER } from '../common/tokens';
import { PagerDutyClient, PagerDutyTrigger } from './pagerduty.client';
import { SlackClient, SlackMessage, SlackPostResult } from './slack.client';

export interface SlackTarget {
  token: string;
  channel: string;
  teamId: string | null;
}

// Tenant-aware delivery. Slack is best-effort (a failed chat message never
// blocks incident handling); PagerDuty is the escalation of last resort,
// so its failures propagate and the command is retried.
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private readonly platformSlackToken: string | undefined;
  readonly dashboardUrl: string | undefined;

  constructor(
    @Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader,
    private readonly slack: SlackClient,
    private readonly pagerduty: PagerDutyClient,
    config: ConfigService,
  ) {
    this.platformSlackToken = config.get<string>('SLACK_BOT_TOKEN') || undefined;
    this.dashboardUrl = config.get<string>('DASHBOARD_URL') || undefined;
  }

  async slackTarget(tenantId: string): Promise<SlackTarget | null> {
    const integration = await this.integrations.get(tenantId, IntegrationType.SLACK);
    if (!integration) return null;
    const token = integration.credentials.botToken ?? this.platformSlackToken;
    if (!token) return null;
    return {
      token,
      channel: integration.config.channel,
      teamId: integration.config.teamId ?? null,
    };
  }

  async postSlack(
    tenantId: string,
    message: SlackMessage,
    threadTs?: string,
  ): Promise<SlackPostResult | null> {
    try {
      const target = await this.slackTarget(tenantId);
      if (!target) return null;
      return await this.slack.post(target.token, target.channel, message, threadTs);
    } catch (err) {
      this.logger.warn('Slack notification failed', { tenantId, ...errorMeta(err) });
      return null;
    }
  }

  async updateSlack(
    tenantId: string,
    channel: string,
    ts: string,
    message: SlackMessage,
  ): Promise<void> {
    try {
      const target = await this.slackTarget(tenantId);
      if (!target) return;
      await this.slack.update(target.token, channel, ts, message);
    } catch (err) {
      this.logger.warn('Slack message update failed', { tenantId, ...errorMeta(err) });
    }
  }

  async pagerDutyRoutingKey(tenantId: string): Promise<string | null> {
    const integration = await this.integrations.get(tenantId, IntegrationType.PAGERDUTY);
    return integration?.credentials.routingKey ?? null;
  }

  // Returns false when the tenant has no PagerDuty integration.
  async page(tenantId: string, event: Omit<PagerDutyTrigger, 'routingKey'>): Promise<boolean> {
    const routingKey = await this.pagerDutyRoutingKey(tenantId);
    if (!routingKey) return false;
    await this.pagerduty.trigger({ ...event, routingKey });
    return true;
  }

  async resolvePage(tenantId: string, dedupKey: string): Promise<void> {
    const routingKey = await this.pagerDutyRoutingKey(tenantId);
    if (!routingKey) return;
    try {
      await this.pagerduty.resolve(routingKey, dedupKey);
    } catch (err) {
      this.logger.warn('PagerDuty resolve failed', { tenantId, dedupKey, ...errorMeta(err) });
    }
  }
}
