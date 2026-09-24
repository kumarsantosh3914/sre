import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { getRedisConnectionOptions } from '@sreai/queue';
import { BULLMQ_QUEUE_NAMES, errorMeta, runWithTraceContext } from '@sreai/shared';
import { Job, Worker } from 'bullmq';
import { bullPrefix } from '../diagnosis/diagnosis.queue';
import { MemoryJobData } from './memory.queue';
import { MemoryOutcome, MemoryService } from './memory.service';

@Injectable()
export class MemoryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MemoryWorker.name);
  private worker: Worker<MemoryJobData, MemoryOutcome> | null = null;

  constructor(private readonly memory: MemoryService) {}

  onApplicationBootstrap(): void {
    if (process.env.WORKERS_ENABLED === 'false') return;
    this.worker = new Worker<MemoryJobData, MemoryOutcome>(
      BULLMQ_QUEUE_NAMES.MEMORY,
      (job: Job<MemoryJobData>) =>
        runWithTraceContext({ traceId: job.data.traceId, tenantId: job.data.tenantId }, () =>
          this.memory.process(job.data.tenantId, job.data.incidentId),
        ),
      { connection: getRedisConnectionOptions(), prefix: bullPrefix(), concurrency: 2 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error('Memory job failed', {
        incidentId: job?.data.incidentId,
        ...errorMeta(err),
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
