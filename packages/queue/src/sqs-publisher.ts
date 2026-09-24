import { MessageAttributeValue, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

export class SqsPublisher {
  constructor(private readonly client: SQSClient) {}

  async sendJson(
    queueUrl: string,
    body: object,
    attributes: Record<string, string> = {},
  ): Promise<string> {
    const messageAttributes: Record<string, MessageAttributeValue> = {};
    for (const [name, value] of Object.entries(attributes)) {
      messageAttributes[name] = { DataType: 'String', StringValue: value };
    }
    const res = await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(body),
        MessageAttributes: messageAttributes,
      }),
    );
    return res.MessageId ?? '';
  }
}
