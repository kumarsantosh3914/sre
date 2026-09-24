import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Tenant, User } from '@sreai/database';
import { getRedisConnectionOptions } from '@sreai/queue';
import { REDIS_CLIENT } from '@sreai/queue/nest';
import {
  BULLMQ_QUEUE_NAMES,
  UserRole,
  errorMeta,
  newTraceId,
  parseTenantSettings,
  runWithTraceContext,
} from '@sreai/shared';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { DataSource, In } from 'typeorm';
import { bullPrefix } from '../approvals/approval-expiry.queue';
import { NotifierService } from '../notify/notifier.service';
import { DigestBuilder } from './digest.builder';
import { renderDigest } from './digest.template';

const DIGEST_HOUR = 9;
const SENT_KEY_TTL_SECONDS = 2 * 86_400;

export function localDateAndHour(at: Date, timezone: string): { date: string; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return localDateAndHour(at, 'UTC');
  }
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

// Hourly tick (BullMQ job scheduler). Each tenant gets its digest in the
// first tick at/after 09:00 local time — once per local day, enforced with
// a Redis SET NX so multiple action-service replicas never double-send.
@Injectable()
export class DigestScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DigestScheduler.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly ses: SESv2Client | null;
  private readonly from: string | undefined;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly builder: DigestBuilder,
    private readonly notifier: NotifierService,
    config: ConfigService,
  ) {
    this.from = config.get<string>('SES_FROM_EMAIL') || undefined;
    this.ses = this.from
      ? new SESv2Client({ region: config.get<string>('AWS_REGION') ?? 'ap-south-1' })
      : null;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.WORKERS_ENABLED === 'false') return;
    const connection = getRedisConnectionOptions();
    this.queue = new Queue(BULLMQ_QUEUE_NAMES.DIGEST, { connection, prefix: bullPrefix() });
    await this.queue.upsertJobScheduler(
      'digest-hourly',
      { pattern: '5 * * * *' },
      { name: 'tick' },
    );
    this.worker = new Worker(
      BULLMQ_QUEUE_NAMES.DIGEST,
      () => runWithTraceContext({ traceId: newTraceId() }, () => this.tick()),
      { connection, prefix: bullPrefix(), concurrency: 1 },
    );
    this.worker.on('failed', (_job, err) =>
      this.logger.error('Digest tick failed', errorMeta(err)),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async tick(now: Date = new Date()): Promise<number> {
    // System-level scheduling is the one place that enumerates tenants;
    // everything per tenant below is tenant-scoped.
    const tenants = await this.ds
      .getRepository(Tenant)
      .find({ select: { id: true, name: true, settings: true } });
    let sent = 0;
    for (const tenant of tenants) {
      const settings = parseTenantSettings(tenant.settings);
      if (!settings.digestEnabled) continue;
      const local = localDateAndHour(now, settings.timezone);
      if (local.hour < DIGEST_HOUR) continue;
      const claimed = await this.redis.set(
        `digest:sent:${tenant.id}:${local.date}`,
        '1',
        'EX',
        SENT_KEY_TTL_SECONDS,
        'NX',
      );
      if (claimed === null) continue;
      try {
        await this.send(tenant, settings.digestRecipients, now);
        sent += 1;
      } catch (err) {
        this.logger.error('Digest failed for tenant', { tenantId: tenant.id, ...errorMeta(err) });
      }
    }
    return sent;
  }

  async send(
    tenant: Pick<Tenant, 'id' | 'name'>,
    configuredRecipients: string[],
    now: Date,
  ): Promise<void> {
    const stats = await this.builder.build(tenant.id, now);
    const content = renderDigest(tenant.name, stats, this.notifier.dashboardUrl);

    const recipients = configuredRecipients.length
      ? configuredRecipients
      : (
          await this.ds.getRepository(User).find({
            where: { tenantId: tenant.id, role: In([UserRole.OWNER, UserRole.ADMIN]) },
            select: { email: true },
          })
        ).map((u) => u.email);

    if (this.ses && this.from && recipients.length) {
      await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: recipients.slice(0, 50) },
          Content: {
            Simple: {
              Subject: { Data: content.subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: content.text, Charset: 'UTF-8' },
                Html: { Data: content.html, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
    }
    await this.notifier.postSlack(tenant.id, {
      text: content.subject,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${content.subject}*\n\`\`\`${content.text.split('\n').slice(2).join('\n')}\`\`\``,
          },
        },
      ],
    });
    this.logger.log('Daily digest sent', {
      tenantId: tenant.id,
      recipients: recipients.length,
      email: Boolean(this.ses),
    });
  }
}
