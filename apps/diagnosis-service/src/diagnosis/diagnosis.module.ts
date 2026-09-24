import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import {
  Action,
  CitationFailure,
  Diagnosis,
  Incident,
  Integration,
  IntegrationReader,
  ResolutionPattern,
  Tenant,
} from '@sreai/database';
import { parseEncryptionKey } from '@sreai/shared';
import { Repository } from 'typeorm';
import { ActionCommandPublisher } from '../common/action-command.publisher';
import { DIAGNOSIS_QUEUE, INTEGRATION_READER } from '../common/tokens';
import { CitationValidator } from './citations/citation-validator';
import { DependencyCollector } from './context/collectors/dependency.collector';
import { DeployCollector } from './context/collectors/deploy.collector';
import {
  CLOUDWATCH_LOGS_FACTORY,
  LogCollector,
  defaultCloudWatchLogsFactory,
} from './context/collectors/log.collector';
import { MetricsCollector } from './context/collectors/metrics.collector';
import { SimilarIncidentCollector } from './context/collectors/similar-incident.collector';
import { ContextCollectorService } from './context/context-collector.service';
import { DiagnosisPipeline } from './diagnosis.pipeline';
import { DiagnosisQueue, createDiagnosisQueue } from './diagnosis.queue';
import { DiagnosisWorker } from './diagnosis.worker';
import { DiagnosisAgent } from './llm/diagnosis-agent.service';
import { EmbeddingService } from './llm/embedding.service';
import { OpenAiClient } from './llm/openai.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Incident,
      Diagnosis,
      CitationFailure,
      Action,
      Integration,
      ResolutionPattern,
      Tenant,
    ]),
  ],
  providers: [
    {
      provide: INTEGRATION_READER,
      inject: [getRepositoryToken(Integration), ConfigService],
      useFactory: (repo: Repository<Integration>, config: ConfigService) =>
        new IntegrationReader(repo, parseEncryptionKey(config.get<string>('ENCRYPTION_KEY'))),
    },
    { provide: CLOUDWATCH_LOGS_FACTORY, useValue: defaultCloudWatchLogsFactory },
    { provide: DIAGNOSIS_QUEUE, useFactory: createDiagnosisQueue },
    OpenAiClient,
    EmbeddingService,
    DiagnosisAgent,
    CitationValidator,
    LogCollector,
    MetricsCollector,
    DeployCollector,
    DependencyCollector,
    SimilarIncidentCollector,
    ContextCollectorService,
    ActionCommandPublisher,
    DiagnosisPipeline,
    DiagnosisQueue,
    DiagnosisWorker,
  ],
  exports: [DiagnosisQueue, ActionCommandPublisher, OpenAiClient, INTEGRATION_READER],
})
export class DiagnosisModule {}
