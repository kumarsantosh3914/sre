import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createWinstonLogger } from '@sreai/shared';
import { NestStructuredLogger, configureHttpApp } from '@sreai/shared/nest';
import { AppModule } from './app.module';

const SERVICE_NAME = 'api-gateway';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestStructuredLogger(createWinstonLogger(SERVICE_NAME)),
    // Raw body is kept for Slack request-signature verification.
    rawBody: true,
  });

  app.use(helmet());
  app.use(cookieParser());
  app.set('trust proxy', 1);
  app.enableCors({
    origin: process.env.DASHBOARD_URL ?? 'http://localhost:3100',
    credentials: true,
  });
  configureHttpApp(app);

  const port = process.env.API_GATEWAY_PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
