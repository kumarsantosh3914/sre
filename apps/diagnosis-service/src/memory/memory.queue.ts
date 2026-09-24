import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { getRedisConnectionOptions } from '@sreai/queue';
import { BULLMQ_QUEUE_NAMES } from '@sreai/shared';
import { Queue } from 'bullmq';
import { MEMORY_QUEUE } from '../common/tokens';
import { bullPrefix } from '../diagnosis/diagnosis.queue';

export interface MemoryJobData {
  tenantId: string;
  incidentId: string;
  traceId: string;
}

export function createMemoryQueue(): Queue<MemoryJobData> {
  return new Queue<MemoryJobData>(BULLMQ_QUEUE_NAMES.MEMORY, {
    connection: getRedisConnectionOptions(),
    prefix: bullPrefix(),
  });
}

@Injectable()
export class MemoryQueue implements OnApplicationShutdown {
  constructor(@Inject(MEMORY_QUEUE) private readonly queue: Queue<MemoryJobData>) {}

  async enqueue(data: MemoryJobData): Promise<void> {
    await this.queue.add('incident-resolved', data, {
      jobId: `memory-${data.incidentId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 24 * 3600, count: 5_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
