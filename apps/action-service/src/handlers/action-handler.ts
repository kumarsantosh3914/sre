import { Diagnosis, Incident, MonitoredService } from '@sreai/database';
import { ExecutableActionType, ServiceMetadata } from '@sreai/shared';

export interface ActionContext {
  tenantId: string;
  incident: Incident;
  service: MonitoredService | null;
  metadata: ServiceMetadata;
  // null for manually requested actions with no diagnosis behind them.
  diagnosis: Diagnosis | null;
  recommendation: string;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export interface PlannedAction {
  type: ExecutableActionType;
  description: string;
  // Everything the handler needs to execute — persisted as the action's
  // payload, so rollback and audits see exactly what was targeted.
  target: Record<string, unknown>;
}

// One allowlisted, typed operation SRE.ai may perform on customer
// infrastructure (build guide Day 22). v1 handlers are deliberately
// conservative: safe, bounded, and reversible where reversal is meaningful.
export interface ActionHandler {
  readonly type: ExecutableActionType;
  readonly reversible: boolean;

  // null → this service isn't configured for this action at all.
  plan(ctx: ActionContext): PlannedAction | null;

  // Pre-checks against live state before anything is changed.
  validate(ctx: ActionContext, planned: PlannedAction): Promise<ValidationResult>;

  // Returns the handler's result, including any state rollback needs.
  execute(ctx: ActionContext, planned: PlannedAction): Promise<Record<string, unknown>>;

  rollback?(
    ctx: ActionContext,
    planned: PlannedAction,
    result: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export function recentDeployOf(diagnosis: Diagnosis | null): unknown {
  return (diagnosis?.contextUsed as { recentDeploy?: unknown } | undefined)?.recentDeploy ?? null;
}
