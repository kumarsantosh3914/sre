import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

// Receives and deletes everything currently on a queue. For tests and
// operational scripts (e.g. inspecting a DLQ) — never used on a hot path.
export async function drainJsonMessages<T = unknown>(
  client: SQSClient,
  queueUrl: string,
  options: { waitTimeSeconds?: number; maxRounds?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let round = 0; round < (options.maxRounds ?? 5); round += 1) {
    const res = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: options.waitTimeSeconds ?? 1,
      }),
    );
    const messages = res.Messages ?? [];
    if (messages.length === 0) break;
    for (const m of messages) {
      out.push(JSON.parse(m.Body ?? 'null') as T);
      if (m.ReceiptHandle) {
        await client.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }),
        );
      }
    }
  }
  return out;
}
