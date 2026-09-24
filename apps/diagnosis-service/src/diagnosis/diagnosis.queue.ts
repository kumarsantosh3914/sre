import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { BULLMQ_QUEUE_NAMES, DIAGNOSIS_JOB, IncidentSeverity } from '@sreai/shared';
import { getRedisConnectionOptions } from '@sreai/queue';
import { Queue } from 'bullmq';
import { DIAGNOSIS_QUEUE } from '../common/tokens';
import { DiagnosisJobData } from './diagnosis.pipeline';

export const DIAGNOSE_JOB_NAME = 'diagnose';

export function bullPrefix(): string {
  return process.env.BULLMQ_PREFIX ?? 'sreai';
}

export function createDiagnosisQueue(): Queue<DiagnosisJobData> {
  return new Queue<DiagnosisJobData>(BULLMQ_QUEUE_NAMES.DIAGNOSIS, {
    connection: getRedisConnectionOptions(),
    prefix: bullPrefix(),
  });
}

export function diagnosisJobId(incidentId: string): string {
  return `diagnose-${incidentId}`;
}

@Injectable()
export class DiagnosisQueue implements OnApplicationShutdown {
  constructor(@Inject(DIAGNOSIS_QUEUE) private readonly queue: Queue<DiagnosisJobData>) {}

  // jobId = incident id, so an SQS redelivery of the same alert can't
  // enqueue a second diagnosis. P1 jumps the queue.
  async enqueue(data: DiagnosisJobData, severity: IncidentSeverity): Promise<void> {
    await this.queue.add(DIAGNOSE_JOB_NAME, data, {
      jobId: diagnosisJobId(data.incidentId),
      priority:
        severity === IncidentSeverity.P1
          ? DIAGNOSIS_JOB.PRIORITY_P1
          : DIAGNOSIS_JOB.PRIORITY_DEFAULT,
      attempts: DIAGNOSIS_JOB.ATTEMPTS,
      backoff: { type: 'exponential', delay: DIAGNOSIS_JOB.BACKOFF_MS },
      removeOnComplete: { age: 24 * 3600, count: 5_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  // Best effort: drop a not-yet-started diagnosis for an incident that
  // resolved or was folded into a storm. An active job skips itself.
  async cancel(incidentId: string): Promise<void> {
    const job = await this.queue.getJob(diagnosisJobId(incidentId));
    if (job && (await job.isWaiting())) {
      await job.remove().catch(() => undefined);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
