import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { traceIdMiddleware } from './trace-id.middleware';

// The cross-cutting HTTP setup every service shares: trace ids, DTO
// validation, the { success, data | error, traceId } envelope, and the
// global exception filter. Used by main.ts and by e2e tests so both run the
// same pipeline.
export function configureHttpApp(app: INestApplication): void {
  app.use(traceIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // A fresh Reflector rather than app.get(Reflector): it's stateless, and
  // pnpm may give an app a different physical @nestjs/core copy (peer
  // variants), which breaks lookup by class token.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(new Reflector()));
  app.enableShutdownHooks();
}
