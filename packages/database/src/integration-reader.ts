import {
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationSchemas,
  IntegrationType,
  decryptJson,
} from '@sreai/shared';
import { Repository } from 'typeorm';
import { Integration } from './entities/integration.entity';

export interface ResolvedIntegration<T extends IntegrationType> {
  id: string;
  config: IntegrationConfig<T>;
  credentials: IntegrationCredentials<T>;
}

export class IntegrationConfigError extends Error {}

// Loads one tenant's integration of a given type, decrypts its
// credentials and validates both halves against the zod schema for that
// type. Returns null when the tenant hasn't connected it (or disabled it)
// — callers treat that as "feature not available", never as an error.
export class IntegrationReader {
  constructor(
    private readonly repo: Repository<Integration>,
    private readonly encryptionKey: Buffer,
  ) {}

  async get<T extends IntegrationType>(
    tenantId: string,
    type: T,
  ): Promise<ResolvedIntegration<T> | null> {
    const row = await this.repo.findOne({ where: { tenantId, type, active: true } });
    if (!row) return null;

    const schemas = IntegrationSchemas[type];
    const config = schemas.config.safeParse(row.config);
    if (!config.success) {
      throw new IntegrationConfigError(`Integration ${type} has invalid config`);
    }
    const credentials = schemas.credentials.safeParse(
      decryptJson(row.encryptedCredentials, this.encryptionKey),
    );
    if (!credentials.success) {
      throw new IntegrationConfigError(`Integration ${type} has invalid credentials`);
    }
    return {
      id: row.id,
      config: config.data as IntegrationConfig<T>,
      credentials: credentials.data as IntegrationCredentials<T>,
    };
  }
}
