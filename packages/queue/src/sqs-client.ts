import { SQSClient, SQSClientConfig } from '@aws-sdk/client-sqs';

export function createSqsClient(): SQSClient {
  const config: SQSClientConfig = {
    region: process.env.AWS_REGION ?? 'ap-south-1',
  };

  if (process.env.LOCALSTACK_ENDPOINT) {
    config.endpoint = process.env.LOCALSTACK_ENDPOINT;
  }

  return new SQSClient(config);
}
