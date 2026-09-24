import { Inject, Injectable, Logger } from '@nestjs/common';
import { QueueUrls, SqsPublisher } from '@sreai/queue';
import { QUEUE_URLS } from '@sreai/queue/nest';
import {
  ActionCommand,
  ActionCommandSchema,
  AlertMessage,
  IncidentQueueMessage,
  IncidentQueueMessageSchema,
  IncidentSeverity,
} from '@sreai/shared';

// The API never mutates incident lifecycle or executes actions itself: it
// validates the request and hands a command to the owning service over
// SQS, so every state change still goes through one writer.
@Injectable()
export class CommandBus {
  private readonly logger = new Logger(CommandBus.name);

  constructor(
    private readonly publisher: SqsPublisher,
    @Inject(QUEUE_URLS) private readonly urls: QueueUrls,
  ) {}

  async action(command: ActionCommand): Promise<void> {
    const valid = ActionCommandSchema.parse(command);
    await this.publisher.sendJson(this.urls.actions, valid, {
      kind: valid.kind,
      tenantId: valid.tenantId,
    });
    this.logger.log('Action command queued', {
      tenantId: valid.tenantId,
      incidentId: valid.incidentId,
      kind: valid.kind,
    });
  }

  async incident(message: IncidentQueueMessage): Promise<void> {
    const valid = IncidentQueueMessageSchema.parse(message);
    const urgent =
      valid.kind === 'alert' && (valid as AlertMessage).alert.severity === IncidentSeverity.P1;
    await this.publisher.sendJson(urgent ? this.urls.p1 : this.urls.p2, valid, {
      kind: valid.kind,
    });
  }
}
