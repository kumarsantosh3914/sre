import { Injectable, Logger } from '@nestjs/common';
import { Incident } from '@sreai/database';
import { errorMeta } from '@sreai/shared';
import { MemoryQueue } from '../memory/memory.queue';

// Work that follows a resolution: queue the memory job (post-mortem,
// pattern learning, runbooks). Never fails the resolution itself.
@Injectable()
export class ResolutionHooks {
  private readonly logger = new Logger(ResolutionHooks.name);

  constructor(private readonly memory: MemoryQueue) {}

  async onResolved(incident: Incident, traceId: string): Promise<void> {
    try {
      await this.memory.enqueue({ tenantId: incident.tenantId, incidentId: incident.id, traceId });
    } catch (err) {
      this.logger.error('Could not queue post-resolution memory job', {
        tenantId: incident.tenantId,
        incidentId: incident.id,
        ...errorMeta(err),
      });
    }
  }
}
