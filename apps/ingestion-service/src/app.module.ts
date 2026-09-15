import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
