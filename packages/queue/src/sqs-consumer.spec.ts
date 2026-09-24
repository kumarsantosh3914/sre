import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { getTraceContext } from '@sreai/shared';
import { z } from 'zod';
import { SqsConsumer } from './sqs-consumer';

const schema = z.object({ traceId: z.string(), value: z.number() });
type Msg = z.infer<typeof schema>;

function makeClient(bodies: string[]) {
  const sent: unknown[] = [];
  const send = jest.fn(async (command: unknown) => {
    sent.push(command);
    if (command instanceof ReceiveMessageCommand) {
      return {
        Messages: bodies.map((Body, i) => ({
          Body,
          MessageId: `m${i}`,
          ReceiptHandle: `r${i}`,
          Attributes: { ApproximateReceiveCount: '1' },
        })),
      };
    }
    return {};
  });
  return { client: { send } as unknown as SQSClient, sent };
}

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

function consumer(client: SQSClient, handler: (m: Msg) => Promise<void>) {
  return new SqsConsumer<Msg>({
    name: 'test',
    client,
    queueUrl: 'q',
    deadLetterQueueUrl: 'dlq',
    schema,
    handler,
    logger,
    traceContextOf: (m) => ({ traceId: m.traceId }),
  });
}

describe('SqsConsumer', () => {
  it('deletes a message after the handler succeeds, inside its trace context', async () => {
    const { client, sent } = makeClient([JSON.stringify({ traceId: 'trace-abc1', value: 1 })]);
    let seenTrace: string | undefined;
    await consumer(client, async () => {
      seenTrace = getTraceContext()?.traceId;
    }).pollOnce();

    expect(seenTrace).toBe('trace-abc1');
    expect(sent.some((c) => c instanceof DeleteMessageCommand)).toBe(true);
  });

  it('leaves the message for redelivery when the handler throws', async () => {
    const { client, sent } = makeClient([JSON.stringify({ traceId: 't', value: 1 })]);
    await consumer(client, async () => {
      throw new Error('db down');
    }).pollOnce();

    expect(sent.some((c) => c instanceof DeleteMessageCommand)).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('quarantines schema-invalid messages straight to the DLQ', async () => {
    const { client, sent } = makeClient(['{"nope":true}', 'not json']);
    const handler = jest.fn();
    await consumer(client, handler).pollOnce();

    expect(handler).not.toHaveBeenCalled();
    const dlqSends = sent.filter(
      (c) => c instanceof SendMessageCommand && c.input.QueueUrl === 'dlq',
    );
    expect(dlqSends).toHaveLength(2);
    expect(sent.filter((c) => c instanceof DeleteMessageCommand)).toHaveLength(2);
  });
});
