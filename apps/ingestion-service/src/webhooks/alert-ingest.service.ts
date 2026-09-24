import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { QueueUrls, SqsPublisher } from '@sreai/queue';
import { QUEUE_URLS, REDIS_CLIENT } from '@sreai/queue/nest';
import {
  AlertMessage,
  AlertSource,
  AlertStatus,
  DEDUPLICATION_TTL_SECONDS,
  IncidentSeverity,
  MAX_RAW_ALERT_BYTES,
  NormalizedAlert,
  STORM_ACTIVE_TTL_SECONDS,
  STORM_THRESHOLD,
  STORM_WINDOW_SECONDS,
  capRawPayload,
  computeAlertFingerprint,
  errorMeta,
  getTraceContext,
  newTraceId,
} from '@sreai/shared';
import IORedis from 'ioredis';
import { IngestResultDto } from './dto/ingest-result.dto';
import { RawAlert } from './normalizers/raw-alert';

// INCR + set-TTL-on-first-hit, atomically: a crash between the two must
// never leave a counter without a TTL (that would mean a permanent storm).
const INCR_WITH_TTL = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export const redisKeys = {
  dedupeFiring: (tenantId: string, fingerprint: string) => `dedupe:${tenantId}:${fingerprint}`,
  dedupeResolved: (tenantId: string, fingerprint: string) =>
    `dedupe:resolved:${tenantId}:${fingerprint}`,
  stormCount: (tenantId: string, service: string) => `storm:count:${tenantId}:${service}`,
  stormActive: (tenantId: string, service: string) => `storm:active:${tenantId}:${service}`,
};

type Outcome = 'accepted' | 'duplicate' | 'storm';

// Webhook → SQS. Everything here is Redis + one SQS send per alert, so a
// webhook returns in milliseconds; incidents are created asynchronously by
// the diagnosis-service (CLAUDE.md rule #2).
@Injectable()
export class AlertIngestService {
  private readonly logger = new Logger(AlertIngestService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    @Inject(QUEUE_URLS) private readonly queueUrls: QueueUrls,
    private readonly publisher: SqsPublisher,
  ) {}

  async ingest(
    tenantId: string,
    source: AlertSource,
    alerts: RawAlert[],
  ): Promise<IngestResultDto> {
    const result: IngestResultDto = { alertIds: [], accepted: 0, duplicates: 0, stormGrouped: 0 };

    const outcomes = await Promise.all(alerts.map((raw) => this.ingestOne(tenantId, source, raw)));
    for (const { outcome, alertId } of outcomes) {
      if (outcome === 'duplicate') {
        result.duplicates += 1;
        continue;
      }
      result.accepted += 1;
      result.alertIds.push(alertId);
      if (outcome === 'storm') result.stormGrouped += 1;
    }

    this.logger.log('Webhook alerts ingested', {
      tenantId,
      source,
      received: alerts.length,
      accepted: result.accepted,
      duplicates: result.duplicates,
      stormGrouped: result.stormGrouped,
    });
    return result;
  }

  private async ingestOne(
    tenantId: string,
    source: AlertSource,
    raw: RawAlert,
  ): Promise<{ outcome: Outcome; alertId: string }> {
    const alert = this.toNormalized(tenantId, source, raw);
    const dedupeKey =
      alert.status === AlertStatus.FIRING
        ? redisKeys.dedupeFiring(tenantId, alert.fingerprint)
        : redisKeys.dedupeResolved(tenantId, alert.fingerprint);

    const first = await this.redis.set(
      dedupeKey,
      alert.alertId,
      'EX',
      DEDUPLICATION_TTL_SECONDS,
      'NX',
    );
    if (first === null) {
      // Still logged for audit — just not re-processed.
      this.logger.log('Duplicate alert suppressed', {
        tenantId,
        source,
        fingerprint: alert.fingerprint,
        status: alert.status,
        title: alert.title,
      });
      return { outcome: 'duplicate', alertId: alert.alertId };
    }

    let outcome: Outcome = 'accepted';
    if (alert.status === AlertStatus.RESOLVED) {
      // A re-fire after resolution is a new occurrence, not a duplicate.
      await this.redis.del(redisKeys.dedupeFiring(tenantId, alert.fingerprint));
    } else {
      const stormKey = await this.detectStorm(tenantId, source, alert);
      if (stormKey) {
        alert.stormKey = stormKey;
        outcome = 'storm';
      }
    }

    try {
      await this.enqueue(alert);
    } catch (err) {
      // Release the dedup slot so the source's retry isn't swallowed as a
      // duplicate, then fail the webhook so the source does retry.
      await this.redis.del(dedupeKey).catch(() => undefined);
      this.logger.error('Failed to enqueue alert', {
        tenantId,
        alertId: alert.alertId,
        ...errorMeta(err),
      });
      throw new ServiceUnavailableException('Alert queue unavailable, retry later');
    }
    return { outcome, alertId: alert.alertId };
  }

  // > STORM_THRESHOLD distinct alerts from one service within
  // STORM_WINDOW_SECONDS → group everything after into one P1 incident,
  // identified by a stormKey that stays open while alerts keep arriving.
  private async detectStorm(
    tenantId: string,
    source: AlertSource,
    alert: NormalizedAlert,
  ): Promise<string | null> {
    const count = Number(
      await this.redis.eval(
        INCR_WITH_TTL,
        1,
        redisKeys.stormCount(tenantId, alert.serviceName),
        String(STORM_WINDOW_SECONDS),
      ),
    );
    if (count <= STORM_THRESHOLD) return null;

    const activeKey = redisKeys.stormActive(tenantId, alert.serviceName);
    const candidate = `storm-${randomUUID()}`;
    const opened = await this.redis.set(activeKey, candidate, 'EX', STORM_ACTIVE_TTL_SECONDS, 'NX');
    let stormKey = candidate;
    if (opened === null) {
      stormKey = (await this.redis.get(activeKey)) ?? candidate;
      await this.redis.expire(activeKey, STORM_ACTIVE_TTL_SECONDS);
    } else {
      this.logger.warn('Alert storm detected', {
        tenantId,
        service: alert.serviceName,
        alertsInWindow: count,
        stormKey,
      });
      await this.enqueue(this.stormSummary(tenantId, source, alert.serviceName, stormKey, count));
    }
    return stormKey;
  }

  private stormSummary(
    tenantId: string,
    source: AlertSource,
    serviceName: string,
    stormKey: string,
    count: number,
  ): NormalizedAlert {
    const title = `Alert storm on ${serviceName}`;
    return {
      alertId: randomUUID(),
      tenantId,
      source,
      status: AlertStatus.FIRING,
      serviceName,
      severity: IncidentSeverity.P1,
      title,
      description:
        `More than ${STORM_THRESHOLD} alerts from ${serviceName} within ` +
        `${STORM_WINDOW_SECONDS}s (${count} so far). Subsequent alerts are grouped into this incident.`,
      labels: { alertname: 'AlertStorm', service: serviceName },
      firedAt: new Date().toISOString(),
      resolvedAt: null,
      fingerprint: computeAlertFingerprint(tenantId, serviceName, title),
      stormKey,
      isStormSummary: true,
      rawPayload: { stormKey, alertsInWindow: count },
    };
  }

  private toNormalized(tenantId: string, source: AlertSource, raw: RawAlert): NormalizedAlert {
    return {
      alertId: randomUUID(),
      tenantId,
      source,
      status: raw.status,
      serviceName: raw.serviceName,
      severity: raw.severity,
      title: raw.title,
      description: raw.description,
      labels: raw.labels,
      firedAt: raw.firedAt.toISOString(),
      resolvedAt: raw.resolvedAt ? raw.resolvedAt.toISOString() : null,
      fingerprint: computeAlertFingerprint(tenantId, raw.serviceName, raw.title),
      stormKey: null,
      isStormSummary: false,
      rawPayload: capRawPayload(raw.rawPayload, MAX_RAW_ALERT_BYTES),
    };
  }

  private async enqueue(alert: NormalizedAlert): Promise<void> {
    const message: AlertMessage = {
      kind: 'alert',
      traceId: getTraceContext()?.traceId ?? newTraceId(),
      alert,
    };
    // P1 — and everything in a storm, which is itself a P1 — jumps the
    // queue; P2/P3 share the normal-priority queue.
    const urgent = alert.severity === IncidentSeverity.P1 || alert.stormKey !== null;
    await this.publisher.sendJson(urgent ? this.queueUrls.p1 : this.queueUrls.p2, message, {
      tenantId: alert.tenantId,
      severity: alert.severity,
      kind: message.kind,
    });
  }
}
