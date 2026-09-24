import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Integration, IntegrationReader } from '@sreai/database';
import { IntegrationType, errorMeta, parseEncryptionKey } from '@sreai/shared';
import { Repository } from 'typeorm';
import { DEFAULT_GENERIC_CONFIG, GenericConfig } from './normalizers/generic.normalizer';

const CACHE_TTL_MS = 60_000;

interface Cached<T> {
  value: T;
  until: number;
}

// Per-tenant webhook settings that live in the integrations table: the
// generic webhook's field mapping and Sentry's signing secret. Cached
// briefly — they change rarely and webhooks are the hot path.
@Injectable()
export class WebhookConfigService {
  private readonly logger = new Logger(WebhookConfigService.name);
  private readonly reader: IntegrationReader;
  private readonly generic = new Map<string, Cached<GenericConfig>>();
  private readonly sentry = new Map<string, Cached<string | null>>();

  constructor(@InjectRepository(Integration) repo: Repository<Integration>, config: ConfigService) {
    this.reader = new IntegrationReader(
      repo,
      parseEncryptionKey(config.get<string>('ENCRYPTION_KEY')),
    );
  }

  async genericConfig(tenantId: string): Promise<GenericConfig> {
    return this.cached(this.generic, tenantId, async () => {
      const integration = await this.reader.get(tenantId, IntegrationType.GENERIC);
      return integration?.config ?? DEFAULT_GENERIC_CONFIG;
    });
  }

  // null → the tenant hasn't configured a secret, so signatures can't be
  // checked (the API key still authenticates the request).
  async sentryClientSecret(tenantId: string): Promise<string | null> {
    return this.cached(this.sentry, tenantId, async () => {
      const integration = await this.reader.get(tenantId, IntegrationType.SENTRY);
      return integration?.credentials.clientSecret ?? null;
    });
  }

  private async cached<T>(
    cache: Map<string, Cached<T>>,
    tenantId: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(tenantId);
    if (hit && hit.until > Date.now()) return hit.value;
    try {
      const value = await load();
      cache.set(tenantId, { value, until: Date.now() + CACHE_TTL_MS });
      return value;
    } catch (err) {
      this.logger.error('Failed to load webhook integration config', {
        tenantId,
        ...errorMeta(err),
      });
      throw err;
    }
  }
}
