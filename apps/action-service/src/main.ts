import './load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { createWinstonLogger } from '@sreai/shared';
import { NestStructuredLogger, configureHttpApp } from '@sreai/shared/nest';
import { AppModule } from './app.module';

const SERVICE_NAME = 'action-service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new NestStructuredLogger(createWinstonLogger(SERVICE_NAME)),
  });

  app.use(helmet());
  configureHttpApp(app);

  const port = process.env.ACTION_SERVICE_PORT ?? 3003;
  await app.listen(port);
}

void bootstrap();
