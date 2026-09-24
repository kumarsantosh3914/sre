import { Injectable } from '@nestjs/common';
import { UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { ActionType } from '@sreai/shared';
import { ActionContext, ActionHandler, PlannedAction, ValidationResult } from './action-handler';
import { EcsClientFactory } from './ecs-client.factory';
import { EcsTarget, describeEcsService, ecsTargetOf } from './ecs-target';

// Adds exactly one task, never beyond the service's configured maxTasks.
// Rollback restores the previous desired count.
@Injectable()
export class ScaleServiceHandler implements ActionHandler {
  readonly type = ActionType.SCALE_SERVICE;
  readonly reversible = true;

  constructor(private readonly ecs: EcsClientFactory) {}

  plan(ctx: ActionContext): PlannedAction | null {
    const target = ecsTargetOf(ctx.metadata);
    // A scaling ceiling is mandatory: no ceiling, no autonomous scaling.
    if (!target || !target.maxTasks) return null;
    return {
      type: this.type,
      description: `Scale ECS service ${target.cluster}/${target.service} out by 1 task (max ${target.maxTasks})`,
      target,
    };
  }

  async validate(ctx: ActionContext, planned: PlannedAction): Promise<ValidationResult> {
    const target = planned.target as EcsTarget;
    const client = await this.ecs.forTenant(ctx.tenantId, target.region);
    const service = await describeEcsService(client, target);
    if (!service || service.status !== 'ACTIVE') {
      return { ok: false, reason: `ECS service is ${service?.status ?? 'not found'}` };
    }
    const desired = service.desiredCount ?? 0;
    if (desired + 1 > (target.maxTasks ?? 0)) {
      return { ok: false, reason: `already at the configured maximum of ${target.maxTasks} tasks` };
    }
    return { ok: true };
  }

  async execute(ctx: ActionContext, planned: PlannedAction): Promise<Record<string, unknown>> {
    const target = planned.target as EcsTarget;
    const client = await this.ecs.forTenant(ctx.tenantId, target.region);
    const service = await describeEcsService(client, target);
    const previousDesiredCount = service?.desiredCount ?? 0;
    const newDesiredCount = previousDesiredCount + 1;
    await client.send(
      new UpdateServiceCommand({
        cluster: target.cluster,
        service: target.service,
        desiredCount: newDesiredCount,
      }),
    );
    return { previousDesiredCount, newDesiredCount };
  }

  async rollback(
    ctx: ActionContext,
    planned: PlannedAction,
    result: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const target = planned.target as EcsTarget;
    const previous = Number(result.previousDesiredCount);
    if (!Number.isInteger(previous) || previous < 0) {
      throw new Error('Original desired count was not recorded; cannot roll back');
    }
    const client = await this.ecs.forTenant(ctx.tenantId, target.region);
    await client.send(
      new UpdateServiceCommand({
        cluster: target.cluster,
        service: target.service,
        desiredCount: previous,
      }),
    );
    return { restoredDesiredCount: previous };
  }
}
