import { Inject, Injectable, Logger } from '@nestjs/common';
import { QueueUrls, SqsPublisher } from '@sreai/queue';
import { QUEUE_URLS } from '@sreai/queue/nest';
import { ActionCommand, ActionCommandSchema } from '@sreai/shared';

// Everything the diagnosis-service needs the action-service to do goes
// through the sreai-actions queue — durable, retried, DLQ-backed.
@Injectable()
export class ActionCommandPublisher {
  private readonly logger = new Logger(ActionCommandPublisher.name);

  constructor(
    private readonly publisher: SqsPublisher,
    @Inject(QUEUE_URLS) private readonly urls: QueueUrls,
  ) {}

  async send(command: ActionCommand): Promise<void> {
    const valid = ActionCommandSchema.parse(command);
    await this.publisher.sendJson(this.urls.actions, valid, {
      kind: valid.kind,
      tenantId: valid.tenantId,
    });
    this.logger.log('Action command sent', {
      tenantId: valid.tenantId,
      incidentId: valid.incidentId,
      kind: valid.kind,
    });
  }
}
