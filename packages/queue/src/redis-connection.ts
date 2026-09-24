import { ConnectionOptions } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

// Parses the full REDIS_URL — credentials, db index and rediss:// TLS —
// so the same config works for local Redis and ElastiCache in transit
// encryption mode.
export function parseRedisUrl(raw: string = redisUrl()): RedisOptions {
  const url = new URL(raw);
  const db = url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0;
  const options: RedisOptions = {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number.isFinite(db) ? db : 0,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  if (url.protocol === 'rediss:') options.tls = {};
  return options;
}

export function getRedisConnectionOptions(): ConnectionOptions {
  return {
    ...parseRedisUrl(),
    // Required by BullMQ workers: blocking commands must not be retried by
    // ioredis itself.
    maxRetriesPerRequest: null,
  };
}

// General-purpose client (dedup windows, pub/sub, caches). Pub/sub
// subscribers need their own dedicated connection — call this again.
export function createRedisClient(): IORedis {
  return new IORedis({ ...parseRedisUrl(), maxRetriesPerRequest: 3, lazyConnect: false });
}
