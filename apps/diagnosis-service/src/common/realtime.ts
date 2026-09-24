import { Logger } from '@nestjs/common';
import { RealtimePublisher } from '@sreai/queue';
import { RealtimeEvent, errorMeta } from '@sreai/shared';

const logger = new Logger('Realtime');

// Dashboard updates are best-effort: a failed publish is logged, never
// allowed to fail incident processing.
export async function publishSafely(
  publisher: RealtimePublisher,
  event: Omit<RealtimeEvent, 'at' | 'payload'> & Partial<RealtimeEvent>,
): Promise<void> {
  try {
    await publisher.publish(event);
  } catch (err) {
    logger.warn('Realtime publish failed', {
      tenantId: event.tenantId,
      incidentId: event.incidentId,
      type: event.type,
      ...errorMeta(err),
    });
  }
}
