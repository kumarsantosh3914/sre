import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import IORedis from 'ioredis';
import { resolveQueueUrls } from '../queue-urls';
import { RealtimePublisher } from '../realtime-publisher';
import { createRedisClient } from '../redis-connection';
import { createSqsClient } from '../sqs-client';
import { SqsPublisher } from '../sqs-publisher';
import { QUEUE_URLS, REDIS_CLIENT, SQS_CLIENT } from './tokens';

@Injectable()
class InfraShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.sqs.destroy();
    await this.redis.quit().catch(() => undefined);
  }
}

// Shared Redis + SQS wiring for every service: one Redis client, one SQS
// client, queue URLs resolved once at boot, and the two publishers.
@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, useFactory: (): IORedis => createRedisClient() },
    { provide: SQS_CLIENT, useFactory: (): SQSClient => createSqsClient() },
    {
      provide: QUEUE_URLS,
      inject: [SQS_CLIENT],
      useFactory: (client: SQSClient) => resolveQueueUrls(client),
    },
    {
      provide: SqsPublisher,
      inject: [SQS_CLIENT],
      useFactory: (client: SQSClient) => new SqsPublisher(client),
    },
    {
      provide: RealtimePublisher,
      inject: [REDIS_CLIENT],
      useFactory: (redis: IORedis) => new RealtimePublisher(redis),
    },
    InfraShutdown,
  ],
  exports: [REDIS_CLIENT, SQS_CLIENT, QUEUE_URLS, SqsPublisher, RealtimePublisher],
})
export class QueueInfraModule {}
