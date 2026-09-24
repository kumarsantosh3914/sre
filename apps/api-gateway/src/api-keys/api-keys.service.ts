import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiKey } from '@sreai/database';
import { API_KEY_ROTATION_GRACE_MS, AlertSource, generateApiKey } from '@sreai/shared';
import { DataSource, IsNull } from 'typeorm';

export interface ApiKeyView {
  id: string;
  name: string;
  displayPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreatedApiKey extends ApiKeyView {
  // Shown exactly once.
  key: string;
  webhookUrls: Record<AlertSource, string>;
}

function view(k: ApiKey): ApiKeyView {
  return {
    id: k.id,
    name: k.name,
    displayPrefix: k.displayPrefix,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    createdAt: k.createdAt,
  };
}

@Injectable()
export class ApiKeysService {
  private readonly webhookBase: string;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    config: ConfigService,
  ) {
    this.webhookBase = (
      config.get<string>('PUBLIC_WEBHOOK_BASE_URL') ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
  }

  async list(tenantId: string): Promise<ApiKeyView[]> {
    const keys = await this.ds.getRepository(ApiKey).find({
      where: { tenantId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return keys.filter((k) => !k.expiresAt || k.expiresAt.getTime() > Date.now()).map(view);
  }

  async create(tenantId: string, name: string): Promise<CreatedApiKey> {
    const generated = generateApiKey();
    const saved = await this.ds.getRepository(ApiKey).save({
      tenantId,
      name,
      displayPrefix: generated.displayPrefix,
      keyHash: generated.hash,
    });
    return {
      ...view(saved),
      key: generated.plaintext,
      webhookUrls: this.webhookUrls(generated.plaintext),
    };
  }

  // New key now; the old one keeps working for 24 hours so senders can be
  // reconfigured without dropping alerts.
  async rotate(tenantId: string, id: string): Promise<CreatedApiKey> {
    return this.ds.transaction(async (m) => {
      const old = await m.findOne(ApiKey, { where: { tenantId, id, revokedAt: IsNull() } });
      if (!old) throw new NotFoundException('API key not found');
      const graceEnds = new Date(Date.now() + API_KEY_ROTATION_GRACE_MS);
      if (!old.expiresAt || old.expiresAt > graceEnds) {
        await m.update(ApiKey, { tenantId, id }, { expiresAt: graceEnds });
      }
      const generated = generateApiKey();
      const saved = await m.save(ApiKey, {
        tenantId,
        name: old.name,
        displayPrefix: generated.displayPrefix,
        keyHash: generated.hash,
      });
      return {
        ...view(saved),
        key: generated.plaintext,
        webhookUrls: this.webhookUrls(generated.plaintext),
      };
    });
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    const res = await this.ds
      .getRepository(ApiKey)
      .update({ tenantId, id, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!res.affected) throw new NotFoundException('API key not found');
  }

  webhookUrls(key: string): Record<AlertSource, string> {
    return Object.fromEntries(
      Object.values(AlertSource).map((source) => [
        source,
        `${this.webhookBase}/webhooks/${source}/${key}`,
      ]),
    ) as Record<AlertSource, string>;
  }
}
