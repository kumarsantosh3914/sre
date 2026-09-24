import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { QueueUrls, SqsConsumer } from '@sreai/queue';
import { QUEUE_URLS, SQS_CLIENT } from '@sreai/queue/nest';
import { IncidentQueueMessage, IncidentQueueMessageSchema } from '@sreai/shared';
import { IncidentIntakeService } from './incident-intake.service';

function tenantOf(message: IncidentQueueMessage): string {
  return message.kind === 'alert' ? message.alert.tenantId : message.tenantId;
}

// One long-poll loop per priority queue, so a P2 backlog never delays P1
// intake. Diagnosis ordering is then enforced by BullMQ job priority.
@Injectable()
export class IntakeConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IntakeConsumer.name);
  private consumers: SqsConsumer<IncidentQueueMessage>[] = [];

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(QUEUE_URLS) private readonly urls: QueueUrls,
    private readonly intake: IncidentIntakeService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.CONSUMERS_ENABLED === 'false') return;
    this.consumers = [
      { name: 'incidents-p1', url: this.urls.p1 },
      { name: 'incidents-p2', url: this.urls.p2 },
    ].map(
      ({ name, url }) =>
        new SqsConsumer<IncidentQueueMessage>({
          name,
          client: this.sqs,
          queueUrl: url,
          deadLetterQueueUrl: this.urls.incidentsDlq,
          schema: IncidentQueueMessageSchema,
          handler: (message) => this.intake.handle(message),
          logger: this.logger,
          traceContextOf: (message) => ({ traceId: message.traceId, tenantId: tenantOf(message) }),
        }),
    );
    this.consumers.forEach((c) => c.start());
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.consumers.map((c) => c.stop()));
  }
}
