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
import { ActionCommand, ActionCommandSchema } from '@sreai/shared';
import { ActionOrchestrator } from '../orchestrator/action-orchestrator.service';

@Injectable()
export class ActionCommandConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ActionCommandConsumer.name);
  private consumer: SqsConsumer<ActionCommand> | null = null;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(QUEUE_URLS) private readonly urls: QueueUrls,
    private readonly orchestrator: ActionOrchestrator,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.CONSUMERS_ENABLED === 'false') return;
    this.consumer = new SqsConsumer<ActionCommand>({
      name: 'actions',
      client: this.sqs,
      queueUrl: this.urls.actions,
      deadLetterQueueUrl: this.urls.actionsDlq,
      schema: ActionCommandSchema,
      handler: (command) => this.orchestrator.handle(command),
      logger: this.logger,
      traceContextOf: (command) => ({ traceId: command.traceId, tenantId: command.tenantId }),
    });
    this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }
}
