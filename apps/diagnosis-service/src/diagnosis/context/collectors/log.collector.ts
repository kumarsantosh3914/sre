import { Inject, Injectable } from '@nestjs/common';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  FilterLogEventsCommandOutput,
} from '@aws-sdk/client-cloudwatch-logs';
import { IntegrationReader } from '@sreai/database';
import { IntegrationType, LOG_WINDOW_MINUTES, safeFetch } from '@sreai/shared';
import { INTEGRATION_READER } from '../../../common/tokens';
import { Collector, CollectorInput, CollectorResult, emptySection } from '../context.types';
import { LogEvent, formatLogEvent, truncateLogEvents } from './log-line';

const MAX_FETCHED_EVENTS = 1_000;
const MAX_PAGES = 5;
const POST_ALERT_MINUTES = 2;

export type CloudWatchLogsFactory = (config: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}) => Pick<CloudWatchLogsClient, 'send'>;

export const defaultCloudWatchLogsFactory: CloudWatchLogsFactory = (config) =>
  new CloudWatchLogsClient({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

export const CLOUDWATCH_LOGS_FACTORY = Symbol('CLOUDWATCH_LOGS_FACTORY');

// Last N log lines around the alert: CloudWatch Logs when the service has a
// log group configured, otherwise Loki. No log source → skipped, and the
// LLM is told logs are missing (not that they were clean).
@Injectable()
export class LogCollector implements Collector {
  readonly source = 'logs' as const;

  constructor(
    @Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader,
    @Inject(CLOUDWATCH_LOGS_FACTORY) private readonly cloudwatchFactory: CloudWatchLogsFactory,
  ) {}

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const { incident, metadata } = input;
    const start = new Date(incident.detectedAt.getTime() - LOG_WINDOW_MINUTES * 60_000);
    const end = new Date(
      Math.min(Date.now(), incident.detectedAt.getTime() + POST_ALERT_MINUTES * 60_000),
    );

    let events: LogEvent[] | null = null;
    if (metadata.logGroup) {
      const aws = await this.integrations.get(incident.tenantId, IntegrationType.AWS);
      if (!aws) {
        return {
          section: emptySection('logs', 'not_configured', 'log group set but no AWS integration'),
        };
      }
      events = await this.fromCloudWatch(
        { region: aws.config.region, ...aws.credentials },
        metadata.logGroup,
        start,
        end,
      );
    } else {
      const loki = await this.integrations.get(incident.tenantId, IntegrationType.LOKI);
      if (loki) {
        const selector = metadata.lokiSelector ?? `{service="${incident.serviceName}"}`;
        events = await this.fromLoki(loki.config, loki.credentials, selector, start, end);
      }
    }

    if (events === null) {
      return {
        section: emptySection(
          'logs',
          'not_configured',
          'no log source (CloudWatch log group or Loki)',
        ),
      };
    }
    if (events.length === 0) {
      return { section: emptySection('logs', 'empty', 'no log lines in the window') };
    }
    const lines = truncateLogEvents(events).map(formatLogEvent);
    return { section: { source: 'logs', status: 'ok', lines } };
  }

  private async fromCloudWatch(
    config: { region: string; accessKeyId: string; secretAccessKey: string },
    logGroupName: string,
    start: Date,
    end: Date,
  ): Promise<LogEvent[]> {
    const client = this.cloudwatchFactory(config);
    const events: LogEvent[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_PAGES && events.length < MAX_FETCHED_EVENTS; page += 1) {
      const res: FilterLogEventsCommandOutput = await client.send(
        new FilterLogEventsCommand({
          logGroupName,
          startTime: start.getTime(),
          endTime: end.getTime(),
          limit: MAX_FETCHED_EVENTS - events.length,
          nextToken,
        }),
      );
      for (const e of res.events ?? []) {
        if (e.message && e.timestamp)
          events.push({ timestamp: new Date(e.timestamp), message: e.message });
      }
      nextToken = res.nextToken;
      if (!nextToken) break;
    }
    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private async fromLoki(
    config: { url: string; username?: string },
    credentials: { password?: string; bearerToken?: string },
    selector: string,
    start: Date,
    end: Date,
  ): Promise<LogEvent[]> {
    const url = new URL('/loki/api/v1/query_range', config.url);
    url.searchParams.set('query', selector);
    url.searchParams.set('start', `${start.getTime()}000000`);
    url.searchParams.set('end', `${end.getTime()}000000`);
    url.searchParams.set('limit', String(MAX_FETCHED_EVENTS));
    url.searchParams.set('direction', 'backward');

    const headers: Record<string, string> = {};
    if (credentials.bearerToken) headers.authorization = `Bearer ${credentials.bearerToken}`;
    else if (config.username && credentials.password) {
      headers.authorization = `Basic ${Buffer.from(`${config.username}:${credentials.password}`).toString('base64')}`;
    }

    const res = await safeFetch(url.toString(), { headers, timeoutMs: 8_000 });
    if (!res.ok) throw new Error(`Loki query failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: { result?: { values?: [string, string][] }[] };
    };
    const events: LogEvent[] = [];
    for (const stream of body.data?.result ?? []) {
      for (const [ns, line] of stream.values ?? []) {
        events.push({ timestamp: new Date(Number(BigInt(ns) / 1_000_000n)), message: line });
      }
    }
    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
