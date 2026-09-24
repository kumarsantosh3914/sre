import { Injectable } from '@nestjs/common';
import { UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { ActionType } from '@sreai/shared';
import {
  ActionContext,
  ActionHandler,
  PlannedAction,
  ValidationResult,
  recentDeployOf,
} from './action-handler';
import { EcsClientFactory } from './ecs-client.factory';
import { EcsTarget, describeEcsService, ecsTargetOf } from './ecs-target';

// Rolling restart via forceNewDeployment. Precondition (build guide):
// only when no deploy happened in the last 30 minutes — restarting on top
// of a bad deploy just restarts the bad code.
@Injectable()
export class RestartServiceHandler implements ActionHandler {
  readonly type = ActionType.RESTART_SERVICE;
  readonly reversible = false;

  constructor(private readonly ecs: EcsClientFactory) {}

  plan(ctx: ActionContext): PlannedAction | null {
    const target = ecsTargetOf(ctx.metadata);
    if (!target) return null;
    return {
      type: this.type,
      description: `Restart ECS service ${target.cluster}/${target.service} (rolling, force new deployment)`,
      target,
    };
  }

  async validate(ctx: ActionContext, planned: PlannedAction): Promise<ValidationResult> {
    if (recentDeployOf(ctx.diagnosis)) {
      return {
        ok: false,
        reason: 'a deploy happened within the last 30 minutes; restarting would not revert it',
      };
    }
    const target = planned.target as EcsTarget;
    const client = await this.ecs.forTenant(ctx.tenantId, target.region);
    const service = await describeEcsService(client, target);
    if (!service || service.status !== 'ACTIVE') {
      return { ok: false, reason: `ECS service is ${service?.status ?? 'not found'}` };
    }
    const inFlight = (service.deployments ?? []).filter((d) => d.rolloutState === 'IN_PROGRESS');
    if (inFlight.length > 0) {
      return { ok: false, reason: 'an ECS deployment is already in progress' };
    }
    return { ok: true };
  }

  async execute(ctx: ActionContext, planned: PlannedAction): Promise<Record<string, unknown>> {
    const target = planned.target as EcsTarget;
    const client = await this.ecs.forTenant(ctx.tenantId, target.region);
    const res = await client.send(
      new UpdateServiceCommand({
        cluster: target.cluster,
        service: target.service,
        forceNewDeployment: true,
      }),
    );
    const primary = res.service?.deployments?.find((d) => d.status === 'PRIMARY');
    return {
      deploymentId: primary?.id ?? null,
      taskDefinition: res.service?.taskDefinition ?? null,
      desiredCount: res.service?.desiredCount ?? null,
    };
  }
}
