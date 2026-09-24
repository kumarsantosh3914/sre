import { REALTIME_CHANNEL, RealtimeEvent, RealtimeEventSchema } from '@sreai/shared';
import IORedis from 'ioredis';

// Fire-and-forget: a dashboard missing one live update is harmless (it
// refetches), so publish failures are reported to the caller but never
// block incident processing.
export class RealtimePublisher {
  constructor(private readonly redis: IORedis) {}

  async publish(
    event: Omit<RealtimeEvent, 'at' | 'payload'> & Partial<RealtimeEvent>,
  ): Promise<void> {
    const full = RealtimeEventSchema.parse({
      payload: {},
      at: new Date().toISOString(),
      ...event,
    });
    await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(full));
  }
}
