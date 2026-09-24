import { Module } from '@nestjs/common';
import { IntegrationTesterService } from './integration-tester.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SlackInteractionsController } from './slack-interactions.controller';

@Module({
  controllers: [IntegrationsController, SlackInteractionsController],
  providers: [IntegrationsService, IntegrationTesterService],
})
export class IntegrationsModule {}
