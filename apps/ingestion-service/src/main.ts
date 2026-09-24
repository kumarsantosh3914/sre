import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { createWinstonLogger } from '@sreai/shared';
import { NestStructuredLogger, configureHttpApp } from '@sreai/shared/nest';
import { AppModule } from './app.module';
import { configureBodyParsers } from './http/body-parsers';

const SERVICE_NAME = 'ingestion-service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestStructuredLogger(createWinstonLogger(SERVICE_NAME)),
    rawBody: true,
  });

  app.use(helmet());
  // Behind a load balancer: rate limiting must key on the client IP.
  app.set('trust proxy', 1);
  configureBodyParsers(app);
  configureHttpApp(app);

  const port = process.env.INGESTION_SERVICE_PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
