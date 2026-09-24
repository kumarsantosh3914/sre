import { lookup } from 'dns/promises';
import { Inject, Injectable } from '@nestjs/common';
import { IntegrationReader } from '@sreai/database';
import { ActionType, IntegrationType, isBlockedAddress } from '@sreai/shared';
import IORedis from 'ioredis';
import { INTEGRATION_READER } from '../common/tokens';
import { pickCachePattern } from '../planning/action-planner';
import { ActionContext, ActionHandler, PlannedAction, ValidationResult } from './action-handler';

const MAX_KEYS = 100_000;
const SCAN_COUNT = 500;

export const REDIS_CLIENT_BUILDER = Symbol('REDIS_CLIENT_BUILDER');
export type RedisClientBuilder = (url: string) => IORedis;
export const defaultRedisClientBuilder: RedisClientBuilder = (url) =>
  new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5_000 });

// Deletes keys matching ONE pattern from the service's allowlist
// (metadata.cacheFlushPatterns) — the model can pick among allowlisted
// patterns, never invent one. SCAN + UNLINK in batches, hard-capped.
@Injectable()
export class FlushCacheHandler implements ActionHandler {
  readonly type = ActionType.FLUSH_CACHE;
  readonly reversible = false;

  constructor(
    @Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader,
    @Inject(REDIS_CLIENT_BUILDER) private readonly buildClient: RedisClientBuilder,
  ) {}

  plan(ctx: ActionContext): PlannedAction | null {
    const pattern = pickCachePattern(ctx.recommendation, ctx.metadata);
    if (!pattern) return null;
    return {
      type: this.type,
      description: `Flush cache keys matching "${pattern}"`,
      target: { pattern },
    };
  }

  async validate(ctx: ActionContext, planned: PlannedAction): Promise<ValidationResult> {
    const pattern = String(planned.target.pattern);
    if (!(ctx.metadata.cacheFlushPatterns ?? []).includes(pattern)) {
      return { ok: false, reason: 'pattern is not in the service allowlist' };
    }
    const redis = await this.integrations.get(ctx.tenantId, IntegrationType.REDIS);
    if (!redis) return { ok: false, reason: 'no Redis integration configured' };
    if (!(await this.isPublicHost(redis.credentials.url))) {
      return { ok: false, reason: 'Redis host resolves to a non-public address' };
    }
    return { ok: true };
  }

  async execute(ctx: ActionContext, planned: PlannedAction): Promise<Record<string, unknown>> {
    const redisIntegration = await this.integrations.get(ctx.tenantId, IntegrationType.REDIS);
    if (!redisIntegration) throw new Error('no Redis integration configured');
    const client = this.buildClient(redisIntegration.credentials.url);
    const pattern = String(planned.target.pattern);
    let deleted = 0;
    try {
      await client.connect();
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
        cursor = next;
        if (keys.length > 0) {
          deleted += await client.unlink(...keys);
        }
      } while (cursor !== '0' && deleted < MAX_KEYS);
    } finally {
      client.disconnect();
    }
    return { pattern, deleted, capped: deleted >= MAX_KEYS };
  }

  // Same SSRF rule as HTTP targets: the tenant's Redis must be public.
  private async isPublicHost(url: string): Promise<boolean> {
    if (process.env.ALLOW_PRIVATE_NETWORK_TARGETS === 'true') return true;
    try {
      const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
      const addresses = await lookup(host, { all: true });
      return addresses.length > 0 && addresses.every((a) => !isBlockedAddress(a.address));
    } catch {
      return false;
    }
  }
}
