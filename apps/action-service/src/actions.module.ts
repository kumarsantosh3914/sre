import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import {
  Action,
  Diagnosis,
  Incident,
  Integration,
  IntegrationReader,
  Runbook,
  Tenant,
  User,
} from '@sreai/database';
import { parseEncryptionKey } from '@sreai/shared';
import { Repository } from 'typeorm';
import { ApprovalExpiryQueue, createApprovalExpiryQueue } from './approvals/approval-expiry.queue';
import { ActionCommandConsumer } from './commands/action-command.consumer';
import { DigestBuilder } from './digest/digest.builder';
import { DigestScheduler } from './digest/digest.scheduler';
import { APPROVAL_EXPIRY_QUEUE, INTEGRATION_READER } from './common/tokens';
import {
  ECS_CLIENT_BUILDER,
  EcsClientFactory,
  defaultEcsClientBuilder,
} from './handlers/ecs-client.factory';
import {
  FlushCacheHandler,
  REDIS_CLIENT_BUILDER,
  defaultRedisClientBuilder,
} from './handlers/flush-cache.handler';
import { HandlerRegistry } from './handlers/handler.registry';
import { RedeployHandler } from './handlers/redeploy.handler';
import { RestartServiceHandler } from './handlers/restart-service.handler';
import { ScaleServiceHandler } from './handlers/scale-service.handler';
import { NotifierService } from './notify/notifier.service';
import { PagerDutyClient } from './notify/pagerduty.client';
import { SlackClient } from './notify/slack.client';
import { ActionExecutor } from './orchestrator/action-executor.service';
import { ActionOrchestrator } from './orchestrator/action-orchestrator.service';
import { EscalationService } from './orchestrator/escalation.service';
import { IncidentContextService } from './orchestrator/incident-context.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Action, Diagnosis, Incident, Integration, Runbook, Tenant, User]),
  ],
  providers: [
    {
      provide: INTEGRATION_READER,
      inject: [getRepositoryToken(Integration), ConfigService],
      useFactory: (repo: Repository<Integration>, config: ConfigService) =>
        new IntegrationReader(repo, parseEncryptionKey(config.get<string>('ENCRYPTION_KEY'))),
    },
    { provide: APPROVAL_EXPIRY_QUEUE, useFactory: createApprovalExpiryQueue },
    { provide: ECS_CLIENT_BUILDER, useValue: defaultEcsClientBuilder },
    { provide: REDIS_CLIENT_BUILDER, useValue: defaultRedisClientBuilder },
    EcsClientFactory,
    RestartServiceHandler,
    ScaleServiceHandler,
    FlushCacheHandler,
    RedeployHandler,
    HandlerRegistry,
    SlackClient,
    PagerDutyClient,
    NotifierService,
    IncidentContextService,
    EscalationService,
    ApprovalExpiryQueue,
    ActionExecutor,
    ActionOrchestrator,
    ActionCommandConsumer,
    DigestBuilder,
    DigestScheduler,
  ],
  exports: [ActionOrchestrator, NotifierService, INTEGRATION_READER, IncidentContextService],
})
export class ActionsModule {}
