import { Injectable } from '@nestjs/common';

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface SlackMessage {
  text: string; // notification / fallback text
  blocks: SlackBlock[];
}

export interface SlackPostResult {
  channel: string;
  ts: string;
}

export class SlackApiError extends Error {}

// Minimal Slack Web API client (chat.postMessage / chat.update). The token
// is per-call: tenants may bring their own bot token.
@Injectable()
export class SlackClient {
  private readonly apiBase = process.env.SLACK_API_URL ?? 'https://slack.com/api';

  async post(
    token: string,
    channel: string,
    message: SlackMessage,
    threadTs?: string,
  ): Promise<SlackPostResult> {
    const body = await this.call(token, 'chat.postMessage', {
      channel,
      text: message.text,
      blocks: message.blocks,
      unfurl_links: false,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    return { channel: String(body.channel), ts: String(body.ts) };
  }

  async update(token: string, channel: string, ts: string, message: SlackMessage): Promise<void> {
    await this.call(token, 'chat.update', {
      channel,
      ts,
      text: message.text,
      blocks: message.blocks,
    });
  }

  private async call(
    token: string,
    method: string,
    payload: object,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ok !== true) {
      throw new SlackApiError(
        `Slack ${method} failed: ${String(body.error ?? `HTTP ${res.status}`)}`,
      );
    }
    return body;
  }
}
