import 'reflect-metadata';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';

// Must run before AppModule is imported below: @sreai/database's
// dataSourceOptions reads process.env.DATABASE_URL at module-evaluation
// time (it's a top-level constant, not read lazily), and that import
// happens as soon as AppModule is required — before ConfigModule.forRoot()
// would otherwise get a chance to load the root .env. Same cwd-vs-__dirname
// reasoning as ConfigModule's envFilePath in app.module.ts: pnpm runs this
// service's scripts with cwd set to this package directory, not the repo
// root, so `dotenv/config`'s default cwd-relative lookup would miss it.
loadEnv({ path: join(__dirname, '..', '..', '..', '.env') });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import { createWinstonLogger } from '@sreai/shared';
import { AppModule } from './app.module';

const SERVICE_NAME = 'api-gateway';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({ instance: createWinstonLogger(SERVICE_NAME) }),
  });

  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.API_GATEWAY_PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
