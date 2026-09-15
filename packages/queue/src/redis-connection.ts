import { ConnectionOptions } from 'bullmq';

export function getRedisConnectionOptions(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
  };
}
