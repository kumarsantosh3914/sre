import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { getRedisConnectionOptions } from '@sreai/queue';
import {
  APPROVAL_TTL_MS,
  BULLMQ_QUEUE_NAMES,
  errorMeta,
  newTraceId,
  runWithTraceContext,
} from '@sreai/shared';
import { Job, Queue, Worker } from 'bullmq';
import { APPROVAL_EXPIRY_QUEUE } from '../common/tokens';

export interface ApprovalExpiryJob {
  tenantId: string;
  incidentId: string;
  actionId: string;
  traceId: string;
}

export function bullPrefix(): string {
  return process.env.BULLMQ_PREFIX ?? 'sreai';
}

export function createApprovalExpiryQueue(): Queue<ApprovalExpiryJob> {
  return new Queue<ApprovalExpiryJob>(BULLMQ_QUEUE_NAMES.APPROVAL_EXPIRY, {
    connection: getRedisConnectionOptions(),
    prefix: bullPrefix(),
  });
}

export type ExpiryHandler = (job: ApprovalExpiryJob) => Promise<void>;

// A delayed BullMQ job per pending approval: if nobody approves or rejects
// within 30 minutes, the action expires and the incident escalates.
@Injectable()
export class ApprovalExpiryQueue implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ApprovalExpiryQueue.name);
  private worker: Worker<ApprovalExpiryJob> | null = null;
  private handler: ExpiryHandler | null = null;

  constructor(@Inject(APPROVAL_EXPIRY_QUEUE) private readonly queue: Queue<ApprovalExpiryJob>) {}

  // Set by the executor (avoids a circular provider dependency).
  onExpire(handler: ExpiryHandler): void {
    this.handler = handler;
  }

  async schedule(job: ApprovalExpiryJob, delayMs: number = APPROVAL_TTL_MS): Promise<void> {
    await this.queue.add('expire', job, {
      jobId: `expire-${job.actionId}`,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  onApplicationBootstrap(): void {
    if (process.env.WORKERS_ENABLED === 'false') return;
    this.worker = new Worker<ApprovalExpiryJob>(
      BULLMQ_QUEUE_NAMES.APPROVAL_EXPIRY,
      (job: Job<ApprovalExpiryJob>) =>
        runWithTraceContext(
          { traceId: job.data.traceId || newTraceId(), tenantId: job.data.tenantId },
          async () => {
            if (!this.handler) throw new Error('No approval expiry handler registered');
            await this.handler(job.data);
          },
        ),
      { connection: getRedisConnectionOptions(), prefix: bullPrefix(), concurrency: 5 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error('Approval expiry job failed', {
        actionId: job?.data.actionId,
        ...errorMeta(err),
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
