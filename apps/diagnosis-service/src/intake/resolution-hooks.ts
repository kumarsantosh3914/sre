import { Injectable } from '@nestjs/common';
import { Incident } from '@sreai/database';

// Extension point for work that follows a resolution (post-mortem,
// resolution-pattern learning) — implemented by the memory layer.
@Injectable()
export class ResolutionHooks {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async onResolved(_incident: Incident, _traceId: string): Promise<void> {
    // Intentionally empty until the memory layer is wired in.
  }
}
