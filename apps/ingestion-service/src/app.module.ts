import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '@sreai/database';
import { QueueInfraModule } from '@sreai/queue/nest';
import { HealthController } from './health/health.controller';
import { WebhooksModule } from './webhooks/webhooks.module';

// Webhook endpoints: 1000 req/min per client IP (build guide's security
// hardening target), generous enough for alert storms from one Alertmanager.
export const WEBHOOK_RATE_LIMIT = { ttl: 60_000, limit: 1_000 };

@Module({
  imports: [
    // pnpm runs this service's scripts with cwd set to this package
    // directory, not the repo root — so the default cwd-relative lookup
    // misses the shared root .env. Point at it explicitly. This path is
    // stable across `nest start` (runs from src/) and `node dist/main.js`
    // (runs from dist/): both sit one level under this package's root.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', join(__dirname, '..', '..', '..', '.env')],
    }),
    TypeOrmModule.forRoot(dataSourceOptions),
    ThrottlerModule.forRoot([WEBHOOK_RATE_LIMIT]),
    QueueInfraModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
