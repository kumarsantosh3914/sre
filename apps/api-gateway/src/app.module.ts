import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '@sreai/database';
import { QueueInfraModule } from '@sreai/queue/nest';
import { AnalyticsModule } from './analytics/analytics.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CommonModule } from './common/common.module';
import { RolesGuard } from './common/roles.guard';
import { HealthController } from './health/health.controller';
import { IncidentsModule } from './incidents/incidents.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RunbooksModule } from './runbooks/runbooks.module';
import { ServicesModule } from './services/services.module';
import { SettingsModule } from './settings/settings.module';
import { TeamModule } from './team/team.module';

// Public API: 100 req/min per client IP (build guide security target).
export const API_RATE_LIMIT = { ttl: 60_000, limit: 100 };

// Everything except TypeORM/infra wiring — shared with the e2e tests so
// they exercise exactly the production module graph.
export const FEATURE_MODULES = [
  CommonModule,
  AuthModule,
  IncidentsModule,
  ServicesModule,
  IntegrationsModule,
  ApiKeysModule,
  AnalyticsModule,
  RunbooksModule,
  SettingsModule,
  TeamModule,
  RealtimeModule,
];

// Order matters: rate limit first, then authenticate, then authorise.
export const GLOBAL_GUARDS = [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

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
    ThrottlerModule.forRoot([API_RATE_LIMIT]),
    QueueInfraModule,
    ...FEATURE_MODULES,
  ],
  controllers: [HealthController],
  providers: GLOBAL_GUARDS,
})
export class AppModule {}
