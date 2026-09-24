import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey, Integration } from '@sreai/database';
import { ApiKeyAuthService } from '../auth/api-key-auth.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AlertIngestService } from './alert-ingest.service';
import { SnsSignatureVerifier } from './sns/sns-message';
import { WebhookConfigService } from './webhook-config.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, Integration])],
  controllers: [WebhooksController],
  providers: [
    ApiKeyAuthService,
    ApiKeyGuard,
    AlertIngestService,
    WebhookConfigService,
    { provide: SnsSignatureVerifier, useFactory: () => new SnsSignatureVerifier() },
  ],
})
export class WebhooksModule {}
