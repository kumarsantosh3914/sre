import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Integration, IntegrationReader } from '@sreai/database';
import { parseEncryptionKey } from '@sreai/shared';
import { Repository } from 'typeorm';

export const INTEGRATION_READER = Symbol('INTEGRATION_READER');

export const integrationReaderProvider = {
  provide: INTEGRATION_READER,
  inject: [getRepositoryToken(Integration), ConfigService],
  useFactory: (repo: Repository<Integration>, config: ConfigService): IntegrationReader =>
    new IntegrationReader(repo, parseEncryptionKey(config.get<string>('ENCRYPTION_KEY'))),
};
