import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiKey } from '@sreai/database';
import { errorMeta, hashApiKey, looksLikeApiKey } from '@sreai/shared';
import { IsNull, Repository } from 'typeorm';

export interface ApiKeyPrincipal {
  tenantId: string;
  apiKeyId: string;
}

interface CacheEntry {
  principal: ApiKeyPrincipal | null;
  until: number;
}

// Revocation takes effect within POSITIVE_TTL_MS: the cache keeps the
// webhook hot path to a map lookup under alert storms.
const POSITIVE_TTL_MS = 60_000;
// Short negative cache blunts key-guessing floods hitting the database.
const NEGATIVE_TTL_MS = 10_000;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 10_000;

// Resolves a webhook API key to its tenant. Deliberately not tenant-scoped:
// like login, this lookup is what establishes the tenant in the first
// place. Keys are looked up by SHA-256 digest (globally unique), so it
// returns at most one row and never lists anything.
@Injectable()
export class ApiKeyAuthService {
  private readonly logger = new Logger(ApiKeyAuthService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(@InjectRepository(ApiKey) private readonly repo: Repository<ApiKey>) {}

  async authenticate(plaintext: string | undefined): Promise<ApiKeyPrincipal | null> {
    if (!plaintext || !looksLikeApiKey(plaintext)) return null;

    const hash = hashApiKey(plaintext);
    const now = Date.now();
    const cached = this.cache.get(hash);
    if (cached && cached.until > now) {
      if (cached.principal) this.touch(cached.principal, now);
      return cached.principal;
    }

    const row = await this.repo.findOne({ where: { keyHash: hash, revokedAt: IsNull() } });
    const valid = row !== null && (row.expiresAt === null || row.expiresAt.getTime() > now);
    const principal = valid && row ? { tenantId: row.tenantId, apiKeyId: row.id } : null;

    // Never cache past a rotated key's expiry.
    const ttl = principal ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    const until = Math.min(now + ttl, row?.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY);
    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    this.cache.set(hash, { principal, until });

    if (principal) this.touch(principal, now);
    return principal;
  }

  private touch(principal: ApiKeyPrincipal, now: number): void {
    const last = this.lastUsedWrites.get(principal.apiKeyId) ?? 0;
    if (now - last < LAST_USED_WRITE_INTERVAL_MS) return;
    this.lastUsedWrites.set(principal.apiKeyId, now);
    // Fire-and-forget: bookkeeping must never slow down or fail a webhook.
    this.repo
      .update(
        { id: principal.apiKeyId, tenantId: principal.tenantId },
        { lastUsedAt: new Date(now) },
      )
      .catch((err: unknown) =>
        this.logger.warn('Failed to record API key usage', {
          tenantId: principal.tenantId,
          apiKeyId: principal.apiKeyId,
          ...errorMeta(err),
        }),
      );
  }
}
