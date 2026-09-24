import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createWinstonLogger } from '@sreai/shared';
import { NestStructuredLogger, configureHttpApp } from '@sreai/shared/nest';
import { AppModule } from './app.module';

const SERVICE_NAME = 'api-gateway';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new NestStructuredLogger(createWinstonLogger(SERVICE_NAME)),
  });

  app.use(helmet());
  app.use(cookieParser());
  configureHttpApp(app);

  const port = process.env.API_GATEWAY_PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
