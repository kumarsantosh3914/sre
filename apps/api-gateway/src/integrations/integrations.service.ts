import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Integration } from '@sreai/database';
import {
  IntegrationSchemas,
  IntegrationType,
  decryptJson,
  encryptJson,
  parseEncryptionKey,
} from '@sreai/shared';
import { DataSource, QueryFailedError } from 'typeorm';
import { ZodTypeAny } from 'zod';
import { CreateIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto';

export interface IntegrationView {
  id: string;
  type: string;
  config: Record<string, unknown>;
  // Which secret fields are set — never their values.
  credentialFields: string[];
  active: boolean;
  lastTestedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

function validate(schema: ZodTypeAny, value: unknown, label: string): Record<string, unknown> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      message: parsed.error.issues.map(
        (i) => `${label}.${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    });
  }
  return parsed.data as Record<string, unknown>;
}

@Injectable()
export class IntegrationsService {
  private readonly key: Buffer;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    config: ConfigService,
  ) {
    this.key = parseEncryptionKey(config.get<string>('ENCRYPTION_KEY'));
  }

  view(row: Integration): IntegrationView {
    let credentialFields: string[] = [];
    try {
      credentialFields = Object.keys(decryptJson(row.encryptedCredentials, this.key));
    } catch {
      credentialFields = [];
    }
    return {
      id: row.id,
      type: row.type,
      config: row.config,
      credentialFields,
      active: row.active,
      lastTestedAt: row.lastTestedAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
    };
  }

  async list(tenantId: string): Promise<IntegrationView[]> {
    const rows = await this.ds
      .getRepository(Integration)
      .find({ where: { tenantId }, order: { createdAt: 'ASC' } });
    return rows.map((r) => this.view(r));
  }

  async find(tenantId: string, id: string): Promise<Integration> {
    const row = await this.ds.getRepository(Integration).findOne({ where: { tenantId, id } });
    if (!row) throw new NotFoundException('Integration not found');
    return row;
  }

  async create(tenantId: string, dto: CreateIntegrationDto): Promise<IntegrationView> {
    const schemas = IntegrationSchemas[dto.type];
    const config = validate(schemas.config, dto.config, 'config');
    const credentials = validate(schemas.credentials, dto.credentials, 'credentials');
    try {
      const row = await this.ds.getRepository(Integration).save({
        tenantId,
        type: dto.type,
        config,
        encryptedCredentials: encryptJson(credentials, this.key),
        active: true,
      });
      return this.view(row);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(`A ${dto.type} integration already exists — update it instead`);
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateIntegrationDto): Promise<IntegrationView> {
    const repo = this.ds.getRepository(Integration);
    const row = await this.find(tenantId, id);
    const schemas = IntegrationSchemas[row.type as IntegrationType];
    if (!schemas) throw new BadRequestException(`Unknown integration type ${row.type}`);

    if (dto.config !== undefined) row.config = validate(schemas.config, dto.config, 'config');
    if (dto.credentials !== undefined) {
      const merged = { ...decryptJson(row.encryptedCredentials, this.key), ...dto.credentials };
      row.encryptedCredentials = encryptJson(
        validate(schemas.credentials, merged, 'credentials'),
        this.key,
      );
    }
    if (dto.active !== undefined) row.active = dto.active;
    return this.view(await repo.save(row));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.ds.getRepository(Integration).delete({ tenantId, id });
    if (!res.affected) throw new NotFoundException('Integration not found');
  }

  async recordTest(tenantId: string, id: string, error: string | null): Promise<void> {
    await this.ds
      .getRepository(Integration)
      .update({ tenantId, id }, { lastTestedAt: new Date(), lastError: error });
  }

  credentials(row: Integration): Record<string, unknown> {
    return decryptJson(row.encryptedCredentials, this.key);
  }
}
