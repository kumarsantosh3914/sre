import { Injectable } from '@nestjs/common';
import { IncidentSeverity } from '@sreai/shared';

export interface PagerDutyTrigger {
  routingKey: string;
  dedupKey: string;
  summary: string;
  source: string;
  severity: IncidentSeverity;
  component?: string;
  customDetails: Record<string, unknown>;
  link?: { href: string; text: string };
}

const SEVERITY: Record<IncidentSeverity, 'critical' | 'error' | 'warning'> = {
  [IncidentSeverity.P1]: 'critical',
  [IncidentSeverity.P2]: 'error',
  [IncidentSeverity.P3]: 'warning',
};

export class PagerDutyError extends Error {}

// PagerDuty Events API v2. dedup_key = SRE.ai incident id, so retries and
// the later "resolve" address the same PagerDuty incident.
@Injectable()
export class PagerDutyClient {
  private readonly url =
    process.env.PAGERDUTY_EVENTS_URL ?? 'https://events.pagerduty.com/v2/enqueue';

  async trigger(event: PagerDutyTrigger): Promise<void> {
    await this.send({
      routing_key: event.routingKey,
      event_action: 'trigger',
      dedup_key: event.dedupKey,
      payload: {
        summary: event.summary.slice(0, 1024),
        source: event.source,
        severity: SEVERITY[event.severity],
        component: event.component,
        custom_details: event.customDetails,
      },
      ...(event.link ? { links: [event.link] } : {}),
    });
  }

  async resolve(routingKey: string, dedupKey: string): Promise<void> {
    await this.send({ routing_key: routingKey, event_action: 'resolve', dedup_key: dedupKey });
  }

  private async send(body: object): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 202) {
      const text = await res.text().catch(() => '');
      throw new PagerDutyError(
        `PagerDuty event rejected: HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
  }
}
