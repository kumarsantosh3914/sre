import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import { createWinstonLogger } from '@sreai/shared';
import { AppModule } from './app.module';

const SERVICE_NAME = 'diagnosis-service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({ instance: createWinstonLogger(SERVICE_NAME) }),
  });

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.DIAGNOSIS_SERVICE_PORT ?? 3002;
  await app.listen(port);
}

void bootstrap();
