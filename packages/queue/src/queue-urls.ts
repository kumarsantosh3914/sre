import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { DLQ_MAX_RECEIVE_COUNT, SQS_QUEUE_NAMES } from '@sreai/shared';

export interface QueueUrls {
  p1: string;
  p2: string;
  incidentsDlq: string;
  actions: string;
  actionsDlq: string;
}

const DLQ_RETENTION_SECONDS = 14 * 24 * 60 * 60;
// Longer than any single message handler (incident intake / action
// command) is allowed to take; an unfinished message reappears after this.
const VISIBILITY_TIMEOUT_SECONDS = 180;

const ENV_KEYS: Record<keyof QueueUrls, string> = {
  p1: 'SQS_P1_QUEUE_URL',
  p2: 'SQS_P2_QUEUE_URL',
  incidentsDlq: 'SQS_DLQ_URL',
  actions: 'SQS_ACTIONS_QUEUE_URL',
  actionsDlq: 'SQS_ACTIONS_DLQ_URL',
};

// Optional prefix so parallel test runs (or several developers sharing
// one LocalStack) get isolated queues. Empty in production.
function queueName(base: string): string {
  return `${process.env.SQS_QUEUE_NAME_PREFIX ?? ''}${base}`;
}

function queueNames(): Record<keyof QueueUrls, string> {
  return {
    p1: queueName(SQS_QUEUE_NAMES.P1),
    p2: queueName(SQS_QUEUE_NAMES.P2),
    incidentsDlq: queueName(SQS_QUEUE_NAMES.DLQ),
    actions: queueName(SQS_QUEUE_NAMES.ACTIONS),
    actionsDlq: queueName(SQS_QUEUE_NAMES.ACTIONS_DLQ),
  };
}

function shouldAutoCreate(): boolean {
  const flag = process.env.SQS_AUTO_CREATE_QUEUES;
  if (flag !== undefined) return flag === 'true';
  // Default on only against a local emulator — production queues are
  // provisioned by infrastructure, never by application start-up.
  return Boolean(process.env.LOCALSTACK_ENDPOINT);
}

async function getQueueArn(client: SQSClient, queueUrl: string): Promise<string> {
  const res = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
  );
  const arn = res.Attributes?.QueueArn;
  if (!arn) throw new Error(`Queue ${queueUrl} has no ARN`);
  return arn;
}

async function createQueue(
  client: SQSClient,
  name: string,
  attributes: Record<string, string>,
): Promise<string> {
  const res = await client.send(
    new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
  );
  if (!res.QueueUrl) throw new Error(`CreateQueue returned no URL for ${name}`);
  return res.QueueUrl;
}

// Creates both queue pairs with their redrive policies (DLQ after
// DLQ_MAX_RECEIVE_COUNT receives, per CLAUDE.md). Idempotent.
export async function ensureQueues(client: SQSClient): Promise<QueueUrls> {
  const names = queueNames();
  const incidentsDlq = await createQueue(client, names.incidentsDlq, {
    MessageRetentionPeriod: String(DLQ_RETENTION_SECONDS),
  });
  const actionsDlq = await createQueue(client, names.actionsDlq, {
    MessageRetentionPeriod: String(DLQ_RETENTION_SECONDS),
  });

  const redrive = (arn: string): Record<string, string> => ({
    VisibilityTimeout: String(VISIBILITY_TIMEOUT_SECONDS),
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: arn,
      maxReceiveCount: String(DLQ_MAX_RECEIVE_COUNT),
    }),
  });

  const incidentsDlqArn = await getQueueArn(client, incidentsDlq);
  const actionsDlqArn = await getQueueArn(client, actionsDlq);

  return {
    p1: await createQueue(client, names.p1, redrive(incidentsDlqArn)),
    p2: await createQueue(client, names.p2, redrive(incidentsDlqArn)),
    incidentsDlq,
    actions: await createQueue(client, names.actions, redrive(actionsDlqArn)),
    actionsDlq,
  };
}

// Queue URLs come from env in production; otherwise they are looked up by
// name (or created, against a local emulator).
export async function resolveQueueUrls(client: SQSClient): Promise<QueueUrls> {
  if (shouldAutoCreate()) {
    return ensureQueues(client);
  }
  const names = queueNames();
  const entries = await Promise.all(
    (Object.keys(ENV_KEYS) as (keyof QueueUrls)[]).map(async (key) => {
      const fromEnv = process.env[ENV_KEYS[key]];
      if (fromEnv) return [key, fromEnv] as const;
      const res = await client.send(new GetQueueUrlCommand({ QueueName: names[key] }));
      if (!res.QueueUrl) throw new Error(`Queue ${names[key]} not found`);
      return [key, res.QueueUrl] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as QueueUrls;
}
