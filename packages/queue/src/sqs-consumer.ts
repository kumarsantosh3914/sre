import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  StructuredLogger,
  TraceContext,
  errorMeta,
  newTraceId,
  runWithTraceContext,
} from '@sreai/shared';
import { ZodType } from 'zod';

export interface MessageMeta {
  messageId: string;
  receiveCount: number;
}

export interface SqsConsumerOptions<T> {
  name: string;
  client: SQSClient;
  queueUrl: string;
  // Where schema-invalid ("poison") messages go immediately — retrying a
  // message that can never parse only delays the DLQ by three receives.
  deadLetterQueueUrl: string;
  schema: ZodType<T>;
  handler: (message: T, meta: MessageMeta) => Promise<void>;
  logger: StructuredLogger;
  batchSize?: number;
  waitTimeSeconds?: number;
  traceContextOf?: (message: T) => TraceContext;
}

const RECEIVE_ERROR_BACKOFF_MS = 2_000;

// Long-polling SQS consumer. A message is deleted only after its handler
// resolves; a throwing handler leaves it to reappear after the visibility
// timeout, and the queue's redrive policy moves it to the DLQ after
// DLQ_MAX_RECEIVE_COUNT attempts.
export class SqsConsumer<T> {
  private running = false;
  private loop: Promise<void> | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly options: SqsConsumerOptions<T>) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
    this.options.logger.log('SQS consumer started', {
      consumer: this.options.name,
      queueUrl: this.options.queueUrl,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort?.abort();
    await this.loop;
    this.options.logger.log('SQS consumer stopped', { consumer: this.options.name });
  }

  // Exposed for tests and for one-shot draining.
  async pollOnce(): Promise<number> {
    this.abort = new AbortController();
    const res = await this.options.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: this.options.batchSize ?? 10,
        WaitTimeSeconds: this.options.waitTimeSeconds ?? 20,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: ['All'],
      }),
      { abortSignal: this.abort.signal },
    );
    const messages = res.Messages ?? [];
    await Promise.allSettled(messages.map((m) => this.process(m)));
    return messages.length;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (err) {
        if (!this.running) break;
        this.options.logger.error('SQS receive failed', {
          consumer: this.options.name,
          ...errorMeta(err),
        });
        await new Promise((resolve) => setTimeout(resolve, RECEIVE_ERROR_BACKOFF_MS));
      }
    }
  }

  private async process(message: Message): Promise<void> {
    const messageId = message.MessageId ?? 'unknown';
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');

    let parsed: T;
    try {
      const result = this.options.schema.safeParse(JSON.parse(message.Body ?? ''));
      if (!result.success) {
        await this.quarantine(message, `schema: ${result.error.message.slice(0, 500)}`);
        return;
      }
      parsed = result.data;
    } catch (err) {
      await this.quarantine(message, `json: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const context = this.options.traceContextOf?.(parsed) ?? { traceId: newTraceId() };
    await runWithTraceContext(context, async () => {
      try {
        await this.options.handler(parsed, { messageId, receiveCount });
        await this.delete(message);
      } catch (err) {
        this.options.logger.error('SQS message handler failed — will be redelivered', {
          consumer: this.options.name,
          messageId,
          receiveCount,
          ...errorMeta(err),
        });
      }
    });
  }

  private async quarantine(message: Message, reason: string): Promise<void> {
    this.options.logger.error('Poison SQS message moved to DLQ', {
      consumer: this.options.name,
      messageId: message.MessageId,
      reason,
    });
    await this.options.client.send(
      new SendMessageCommand({
        QueueUrl: this.options.deadLetterQueueUrl,
        MessageBody: message.Body ?? '',
        MessageAttributes: {
          quarantineReason: { DataType: 'String', StringValue: reason.slice(0, 1000) },
          sourceConsumer: { DataType: 'String', StringValue: this.options.name },
        },
      }),
    );
    await this.delete(message);
  }

  private async delete(message: Message): Promise<void> {
    if (!message.ReceiptHandle) return;
    await this.options.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.options.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}
