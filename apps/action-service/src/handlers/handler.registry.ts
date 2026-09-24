import { Injectable } from '@nestjs/common';
import { ExecutableActionType } from '@sreai/shared';
import { ActionHandler } from './action-handler';
import { FlushCacheHandler } from './flush-cache.handler';
import { RedeployHandler } from './redeploy.handler';
import { RestartServiceHandler } from './restart-service.handler';
import { ScaleServiceHandler } from './scale-service.handler';

@Injectable()
export class HandlerRegistry {
  private readonly handlers: Map<ExecutableActionType, ActionHandler>;

  constructor(
    restart: RestartServiceHandler,
    scale: ScaleServiceHandler,
    flush: FlushCacheHandler,
    redeploy: RedeployHandler,
  ) {
    this.handlers = new Map<ExecutableActionType, ActionHandler>(
      [restart, scale, flush, redeploy].map((h) => [h.type, h]),
    );
  }

  get(type: ExecutableActionType): ActionHandler {
    const handler = this.handlers.get(type);
    if (!handler) throw new Error(`No handler registered for ${type}`);
    return handler;
  }
}
