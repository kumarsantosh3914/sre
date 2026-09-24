import { NestExpressApplication } from '@nestjs/platform-express';

// rawBody (enabled at app creation) is kept for Sentry signature checks.
// SNS posts JSON with Content-Type text/plain, hence the text parser.
export function configureBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('text', { type: 'text/plain', limit: '256kb' });
}
