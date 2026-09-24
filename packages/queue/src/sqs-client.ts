import { SQSClient, SQSClientConfig } from '@aws-sdk/client-sqs';

export function createSqsClient(): SQSClient {
  const config: SQSClientConfig = {
    region: process.env.AWS_REGION ?? 'ap-south-1',
  };

  if (process.env.LOCALSTACK_ENDPOINT) {
    config.endpoint = process.env.LOCALSTACK_ENDPOINT;
    // LocalStack / ElasticMQ accept any credentials; don't make local dev
    // depend on a real AWS profile.
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    };
  }

  return new SQSClient(config);
}
