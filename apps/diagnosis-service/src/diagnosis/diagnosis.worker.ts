import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { writeAuditLog } from '@sreai/database';
import { getRedisConnectionOptions } from '@sreai/queue';
import {
  AuditActorType,
  BULLMQ_QUEUE_NAMES,
  DIAGNOSIS_JOB,
  errorMeta,
  runWithTraceContext,
} from '@sreai/shared';
import { Job, Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { ActionCommandPublisher } from '../common/action-command.publisher';
import { withTimeout } from '../common/time';
import { DiagnosisJobData, DiagnosisPipeline, PipelineOutcome } from './diagnosis.pipeline';
import { bullPrefix } from './diagnosis.queue';

// BullMQ worker: up to DIAGNOSIS_CONCURRENCY diagnoses in parallel, each
// capped at 120s, retried 3× with exponential backoff. A job that exhausts
// its retries still reaches a human: the action-service escalates it with
// the raw alert.
@Injectable()
export class DiagnosisWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DiagnosisWorker.name);
  private worker: Worker<DiagnosisJobData, PipelineOutcome> | null = null;

  constructor(
    private readonly pipeline: DiagnosisPipeline,
    private readonly commands: ActionCommandPublisher,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.WORKERS_ENABLED === 'false') return;
    this.worker = new Worker<DiagnosisJobData, PipelineOutcome>(
      BULLMQ_QUEUE_NAMES.DIAGNOSIS,
      (job) => this.process(job),
      {
        connection: getRedisConnectionOptions(),
        prefix: bullPrefix(),
        concurrency: Number(process.env.DIAGNOSIS_CONCURRENCY ?? 5),
      },
    );
    this.worker.on('failed', (job, err) => {
      if (job) void this.onFailed(job, err);
    });
    this.worker.on('error', (err) => this.logger.error('Diagnosis worker error', errorMeta(err)));
    this.logger.log('Diagnosis worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  process(job: Job<DiagnosisJobData>): Promise<PipelineOutcome> {
    const { traceId, tenantId, incidentId } = job.data;
    return runWithTraceContext({ traceId, tenantId }, async () => {
      this.logger.log('Diagnosis job started', { incidentId, attempt: job.attemptsMade + 1 });
      const outcome = await withTimeout(
        this.pipeline.run(job.data),
        DIAGNOSIS_JOB.TIMEOUT_MS,
        'diagnosis job',
      );
      this.logger.log('Diagnosis job finished', { incidentId, outcome });
      return outcome;
    });
  }

  async onFailed(job: Job<DiagnosisJobData>, err: Error): Promise<void> {
    const { traceId, tenantId, incidentId } = job.data;
    await runWithTraceContext({ traceId, tenantId }, async () => {
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.error('Diagnosis job failed', {
        incidentId,
        attempt: job.attemptsMade,
        final,
        ...errorMeta(err),
      });
      if (!final) return;
      try {
        await writeAuditLog(this.dataSource.manager, {
          tenantId,
          incidentId,
          actorType: AuditActorType.SYSTEM,
          event: 'diagnosis.failed',
          metadata: { reason: err.message.slice(0, 500), attempts: job.attemptsMade },
        });
        await this.commands.send({
          kind: 'diagnosis_failed',
          traceId,
          tenantId,
          incidentId,
          reason: err.message.slice(0, 2000),
        });
      } catch (sendErr) {
        this.logger.error('Could not report failed diagnosis for escalation', {
          incidentId,
          ...errorMeta(sendErr),
        });
      }
    });
  }
}
