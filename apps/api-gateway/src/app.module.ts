import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '@sreai/database';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { HealthController } from './health/health.controller';

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
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    // Secure by default: every route requires a valid access token unless
    // explicitly marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
