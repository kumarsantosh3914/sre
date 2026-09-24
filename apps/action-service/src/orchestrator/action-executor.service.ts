import { Injectable, Logger } from '@nestjs/common';
import { Action, Diagnosis, Incident, writeAuditLog } from '@sreai/database';
import {
  APPROVAL_TTL_MS,
  ActionStatus,
  ActionTier,
  ActionType,
  AuditActorType,
  ExecutableActionType,
  IncidentStatus,
  ROLLBACK_WINDOW_MS,
  errorMeta,
  getTraceContext,
  isExecutableActionType,
  newTraceId,
} from '@sreai/shared';
import { In } from 'typeorm';
import { ApprovalExpiryJob, ApprovalExpiryQueue } from '../approvals/approval-expiry.queue';
import {
  ActionContext,
  ActionHandler,
  PlannedAction,
  ValidationResult,
} from '../handlers/action-handler';
import { HandlerRegistry } from '../handlers/handler.registry';
import { NotifierService } from '../notify/notifier.service';
import {
  approvalMessage,
  autoExecutedMessage,
  decisionMessage,
  rolledBackMessage,
} from '../notify/slack-messages';
import { EscalationService } from './escalation.service';
import { IncidentContextService } from './incident-context.service';

export interface Actor {
  type: AuditActorType;
  id: string | null;
}

const SYSTEM: Actor = { type: AuditActorType.SYSTEM, id: null };

function actorString(actor: Actor): string {
  return actor.id ? `${actor.type}:${actor.id}` : actor.type;
}

export class ActionRefusedError extends Error {}

// Runs handlers and records every step: an action row exists (PENDING)
// before the handler touches anything, so a crash mid-execution leaves a
// visible trace and a redelivered command can't execute twice.
@Injectable()
export class ActionExecutor {
  private readonly logger = new Logger(ActionExecutor.name);

  constructor(
    private readonly ctx: IncidentContextService,
    private readonly registry: HandlerRegistry,
    private readonly notifier: NotifierService,
    private readonly escalation: EscalationService,
    private readonly approvals: ApprovalExpiryQueue,
  ) {
    this.approvals.onExpire((job) => this.expire(job));
  }

  handlerFor(type: ExecutableActionType): ActionHandler {
    return this.registry.get(type);
  }

  async safeValidate(
    handler: ActionHandler,
    ctx: ActionContext,
    planned: PlannedAction,
  ): Promise<ValidationResult> {
    try {
      return await handler.validate(ctx, planned);
    } catch (err) {
      return {
        ok: false,
        reason: `pre-check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ---------- AUTO ----------

  async autoExecute(
    ctx: ActionContext,
    handler: ActionHandler,
    planned: PlannedAction,
  ): Promise<void> {
    const action = await this.createAction(
      ctx,
      planned,
      ActionTier.AUTO,
      ActionStatus.PENDING,
      SYSTEM,
    );
    const ok = await this.run(ctx, handler, planned, action, SYSTEM);
    if (!ok || !ctx.diagnosis) return;
    const fresh = (await this.ctx.loadAction(ctx.tenantId, action.id)) ?? action;
    const posted = await this.notifier.postSlack(
      ctx.tenantId,
      autoExecutedMessage(
        this.ctx.messageContext(ctx.incident, this.notifier.dashboardUrl),
        ctx.diagnosis,
        fresh,
      ),
      this.ctx.slackThread(ctx.incident)?.ts,
    );
    if (posted) await this.ctx.appendActionTrail(fresh, { event: 'slack.posted', ...posted });
  }

  // ---------- DRAFT ----------

  async requestApproval(
    ctx: ActionContext,
    planned: PlannedAction,
    note: string | null,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
    const action = await this.createAction(
      ctx,
      planned,
      ActionTier.DRAFT,
      ActionStatus.PENDING,
      SYSTEM,
      {
        expiresAt,
        auditEvent: 'action.approval_requested',
        metadata: note ? { downgradedFromAuto: note } : {},
      },
    );
    await this.approvals.schedule({
      tenantId: ctx.tenantId,
      incidentId: ctx.incident.id,
      actionId: action.id,
      traceId: getTraceContext()?.traceId ?? newTraceId(),
    });
    if (ctx.diagnosis) {
      const posted = await this.notifier.postSlack(
        ctx.tenantId,
        approvalMessage(
          this.ctx.messageContext(ctx.incident, this.notifier.dashboardUrl),
          ctx.diagnosis,
          action,
        ),
        this.ctx.slackThread(ctx.incident)?.ts,
      );
      if (posted) await this.ctx.appendActionTrail(action, { event: 'slack.posted', ...posted });
    }
    this.logger.log('Approval requested', {
      tenantId: ctx.tenantId,
      incidentId: ctx.incident.id,
      actionId: action.id,
      actionType: planned.type,
    });
  }

  async decide(
    tenantId: string,
    actionId: string,
    decision: 'approve' | 'reject',
    actor: Actor,
    reason: string | null,
  ): Promise<void> {
    const decided = await this.ctx.dataSource.transaction(async (m) => {
      const action = await m
        .getRepository(Action)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where('a.tenant_id = :tenantId AND a.id = :actionId', { tenantId, actionId })
        .getOne();
      if (!action || action.status !== ActionStatus.PENDING || action.tier !== ActionTier.DRAFT)
        return null;
      if (action.expiresAt && action.expiresAt.getTime() <= Date.now()) return null;

      const status = decision === 'approve' ? ActionStatus.APPROVED : ActionStatus.REJECTED;
      await m.update(
        Action,
        { tenantId, id: actionId },
        { status, decidedBy: actorString(actor), decidedAt: new Date(), error: reason },
      );
      await writeAuditLog(m, {
        tenantId,
        incidentId: action.incidentId,
        actorType: actor.type,
        actorId: actor.id,
        event: decision === 'approve' ? 'action.approved' : 'action.rejected',
        before: { status: action.status },
        after: { status },
        metadata: { actionId, actionType: action.actionType, ...(reason ? { reason } : {}) },
      });
      return {
        ...action,
        status,
        decidedBy: actorString(actor),
        decidedAt: new Date(),
        error: reason,
      };
    });
    if (!decided) {
      this.logger.warn('Decision ignored: action is not awaiting approval', {
        tenantId,
        actionId,
        decision,
      });
      return;
    }

    const incident = await this.ctx.loadIncident(tenantId, decided.incidentId);
    if (!incident) return;
    const diagnosis = await this.diagnosisOf(decided);
    const who = actor.type === AuditActorType.SLACK ? `<@${actor.id}>` : 'a teammate';

    if (decision === 'reject') {
      await this.updateSlack(decided, incident, `Rejected by ${who}${reason ? `: ${reason}` : ''}`);
      await this.escalation.escalate({
        incident,
        diagnosis,
        reason: `Proposed action "${decided.description}" was rejected${reason ? `: ${reason}` : ''}`,
        page: true,
        actorType: actor.type,
        actorId: actor.id,
      });
      return;
    }

    await this.updateSlack(decided, incident, `Approved by ${who} — executing`);
    if (this.ctx.isClosed(incident)) {
      await this.markFailed(decided, 'incident closed before the approved action could run', actor);
      return;
    }
    const ctx = this.ctx.actionContext(incident, diagnosis);
    const type = decided.actionType;
    if (!isExecutableActionType(type)) return;
    const handler = this.registry.get(type);
    const planned = this.plannedFromAction(decided, type);
    await this.run(ctx, handler, planned, decided, actor);
  }

  async expire(job: ApprovalExpiryJob): Promise<void> {
    const expired = await this.ctx.dataSource.transaction(async (m) => {
      const action = await m
        .getRepository(Action)
        .createQueryBuilder('a')
        .setLock('pessimistic_write')
        .where('a.tenant_id = :tenantId AND a.id = :actionId', {
          tenantId: job.tenantId,
          actionId: job.actionId,
        })
        .getOne();
      if (!action || action.status !== ActionStatus.PENDING) return null;
      await m.update(
        Action,
        { tenantId: job.tenantId, id: action.id },
        { status: ActionStatus.EXPIRED },
      );
      await writeAuditLog(m, {
        tenantId: job.tenantId,
        incidentId: action.incidentId,
        actorType: AuditActorType.SYSTEM,
        event: 'action.expired',
        before: { status: ActionStatus.PENDING },
        after: { status: ActionStatus.EXPIRED },
        metadata: { actionId: action.id },
      });
      return action;
    });
    if (!expired) return;
    const incident = await this.ctx.loadIncident(job.tenantId, job.incidentId);
    if (!incident) return;
    await this.updateSlack(expired, incident, 'Expired — no decision within 30 minutes; escalated');
    if (this.ctx.isClosed(incident)) return;
    await this.escalation.escalate({
      incident,
      diagnosis: await this.diagnosisOf(expired),
      reason: 'Approval request expired after 30 minutes without a decision',
      page: true,
    });
  }

  // ---------- rollback ----------

  async rollback(tenantId: string, actionId: string, actor: Actor): Promise<void> {
    const original = await this.ctx.loadAction(tenantId, actionId);
    const refuse = async (reason: string): Promise<void> => {
      this.logger.warn('Rollback refused', { tenantId, actionId, reason });
      await writeAuditLog(this.ctx.dataSource.manager, {
        tenantId,
        incidentId: original?.incidentId ?? null,
        actorType: actor.type,
        actorId: actor.id,
        event: 'action.rollback_refused',
        metadata: { actionId, reason },
      });
    };
    if (!original) return refuse('action not found');
    if (original.status !== ActionStatus.EXECUTED || !original.executedAt) {
      return refuse(`action is ${original.status}, not executed`);
    }
    if (Date.now() - original.executedAt.getTime() > ROLLBACK_WINDOW_MS) {
      return refuse('rollback window (1 hour) has passed');
    }
    if (!isExecutableActionType(original.actionType))
      return refuse('action type cannot be rolled back');
    const handler = this.registry.get(original.actionType);
    if (!handler.reversible || !handler.rollback)
      return refuse(`${original.actionType} is not reversible`);

    const incident = await this.ctx.loadIncident(tenantId, original.incidentId);
    if (!incident) return refuse('incident not found');
    const ctx = this.ctx.actionContext(incident, await this.diagnosisOf(original));
    const planned = this.plannedFromAction(original, original.actionType);

    let result: Record<string, unknown> = {};
    let error: string | null = null;
    try {
      result = await handler.rollback(ctx, planned, original.result ?? {});
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await this.ctx.dataSource.transaction(async (m) => {
      const rollbackAction = await m.save(
        Action,
        m.create(Action, {
          tenantId,
          incidentId: incident.id,
          tier: original.tier,
          actionType: ActionType.ROLLBACK,
          status: error ? ActionStatus.FAILED : ActionStatus.EXECUTED,
          description: `Roll back: ${original.description}`,
          payload: { rolledBackActionId: original.id, target: planned.target },
          result,
          error,
          parentActionId: original.id,
          requestedBy: actorString(actor),
          executedAt: new Date(),
        }),
      );
      if (!error) {
        await m.update(
          Action,
          { tenantId, id: original.id },
          { status: ActionStatus.ROLLED_BACK, rolledBackAt: new Date() },
        );
      }
      // Either way a human now owns this incident.
      await m.update(
        Incident,
        {
          tenantId,
          id: incident.id,
          status: In([IncidentStatus.ACTING, IncidentStatus.DIAGNOSING, IncidentStatus.DETECTING]),
        },
        { status: IncidentStatus.ESCALATED },
      );
      await writeAuditLog(m, {
        tenantId,
        incidentId: incident.id,
        actorType: actor.type,
        actorId: actor.id,
        event: error ? 'action.rollback_failed' : 'action.rolled_back',
        before: { status: original.status },
        after: { status: error ? original.status : ActionStatus.ROLLED_BACK },
        metadata: {
          actionId: original.id,
          rollbackActionId: rollbackAction.id,
          ...(error ? { error } : {}),
        },
      });
    });

    await this.notifier.postSlack(
      tenantId,
      rolledBackMessage(this.ctx.messageContext(incident, this.notifier.dashboardUrl), original),
      this.ctx.slackThread(incident)?.ts,
    );
    await this.ctx.publish({
      tenantId,
      incidentId: incident.id,
      type: 'action.updated',
      status: IncidentStatus.ESCALATED,
      payload: { actionId: original.id, rolledBack: !error },
    });
  }

  // ---------- manual ----------

  async manual(
    incident: Incident,
    type: ExecutableActionType,
    actor: Actor,
    note: string | null,
  ): Promise<void> {
    const diagnosis = await this.ctx.latestDiagnosis(incident.tenantId, incident.id);
    const ctx = this.ctx.actionContext(incident, diagnosis);
    const handler = this.registry.get(type);
    const planned = handler.plan(ctx);
    if (!planned) {
      await writeAuditLog(this.ctx.dataSource.manager, {
        tenantId: incident.tenantId,
        incidentId: incident.id,
        actorType: actor.type,
        actorId: actor.id,
        event: 'action.refused',
        metadata: { actionType: type, reason: `service is not configured for ${type}`, note },
      });
      return;
    }
    // Human-initiated, so recorded as an already-approved DRAFT action.
    const action = await this.createAction(
      ctx,
      planned,
      ActionTier.DRAFT,
      ActionStatus.APPROVED,
      actor,
      {
        decidedBy: actorString(actor),
        metadata: note ? { note } : {},
      },
    );
    await this.run(ctx, handler, planned, action, actor);
  }

  // ---------- internals ----------

  private async run(
    ctx: ActionContext,
    handler: ActionHandler,
    planned: PlannedAction,
    action: Action,
    actor: Actor,
  ): Promise<boolean> {
    const validation = await this.safeValidate(handler, ctx, planned);
    if (!validation.ok) {
      await this.markFailed(action, `pre-check failed: ${validation.reason}`, actor);
      await this.escalation.escalate({
        incident: ctx.incident,
        diagnosis: ctx.diagnosis,
        reason: `Could not run "${planned.description}": ${validation.reason}`,
        page: true,
      });
      return false;
    }

    try {
      const result = await handler.execute(ctx, planned);
      await this.ctx.dataSource.transaction(async (m) => {
        // Targeted update, never save(action): the in-memory row can be
        // stale (e.g. decidedBy set by the approval transaction).
        await m
          .createQueryBuilder()
          .update(Action)
          .set({
            status: ActionStatus.EXECUTED,
            executedAt: new Date(),
            result: () => ':result::jsonb',
          })
          .setParameter('result', JSON.stringify(result))
          .where('tenant_id = :tenantId AND id = :id', { tenantId: action.tenantId, id: action.id })
          .execute();
        await writeAuditLog(m, {
          tenantId: ctx.tenantId,
          incidentId: ctx.incident.id,
          actorType: actor.type,
          actorId: actor.id,
          event: 'action.executed',
          before: { status: action.status },
          after: { status: ActionStatus.EXECUTED },
          metadata: { actionId: action.id, actionType: planned.type, tier: action.tier, result },
        });
      });
      this.logger.log('Action executed', {
        tenantId: ctx.tenantId,
        incidentId: ctx.incident.id,
        actionId: action.id,
        actionType: planned.type,
        tier: action.tier,
      });
      await this.ctx.publish({
        tenantId: ctx.tenantId,
        incidentId: ctx.incident.id,
        type: 'action.updated',
        payload: { actionId: action.id, status: ActionStatus.EXECUTED },
      });
      return true;
    } catch (err) {
      this.logger.error('Action failed', {
        tenantId: ctx.tenantId,
        incidentId: ctx.incident.id,
        actionId: action.id,
        ...errorMeta(err),
      });
      await this.markFailed(action, err instanceof Error ? err.message : String(err), actor);
      await this.escalation.escalate({
        incident: ctx.incident,
        diagnosis: ctx.diagnosis,
        reason: `"${planned.description}" failed: ${err instanceof Error ? err.message : String(err)}`,
        page: true,
      });
      return false;
    }
  }

  private async createAction(
    ctx: ActionContext,
    planned: PlannedAction,
    tier: ActionTier,
    status: ActionStatus,
    actor: Actor,
    extra: {
      expiresAt?: Date;
      decidedBy?: string;
      auditEvent?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<Action> {
    return this.ctx.dataSource.transaction(async (m) => {
      const action = await m.save(
        Action,
        m.create(Action, {
          tenantId: ctx.tenantId,
          incidentId: ctx.incident.id,
          tier,
          status,
          actionType: planned.type,
          description: planned.description,
          payload: {
            diagnosisId: ctx.diagnosis?.id ?? null,
            target: planned.target,
            recommendation: ctx.recommendation,
          },
          requestedBy: actorString(actor),
          decidedBy: extra.decidedBy ?? null,
          decidedAt: extra.decidedBy ? new Date() : null,
          expiresAt: extra.expiresAt ?? null,
        }),
      );
      await writeAuditLog(m, {
        tenantId: ctx.tenantId,
        incidentId: ctx.incident.id,
        actorType: actor.type,
        actorId: actor.id,
        event: extra.auditEvent ?? 'action.started',
        after: { status, tier, actionType: planned.type },
        metadata: {
          actionId: action.id,
          description: planned.description,
          ...(extra.metadata ?? {}),
        },
      });
      return action;
    });
  }

  private async markFailed(action: Action, error: string, actor: Actor): Promise<void> {
    await this.ctx.dataSource.transaction(async (m) => {
      await m.update(
        Action,
        { tenantId: action.tenantId, id: action.id },
        { status: ActionStatus.FAILED, error },
      );
      await writeAuditLog(m, {
        tenantId: action.tenantId,
        incidentId: action.incidentId,
        actorType: actor.type,
        actorId: actor.id,
        event: 'action.failed',
        before: { status: action.status },
        after: { status: ActionStatus.FAILED },
        metadata: { actionId: action.id, error },
      });
    });
  }

  private plannedFromAction(action: Action, type: ExecutableActionType): PlannedAction {
    const target = (action.payload.target ?? {}) as Record<string, unknown>;
    return { type, description: action.description, target };
  }

  private async diagnosisOf(action: Action): Promise<Diagnosis | null> {
    const id = action.payload.diagnosisId;
    return typeof id === 'string' ? this.ctx.loadDiagnosis(action.tenantId, id) : null;
  }

  private async updateSlack(action: Action, incident: Incident, outcome: string): Promise<void> {
    const fresh = (await this.ctx.loadAction(action.tenantId, action.id)) ?? action;
    const message = this.ctx.slackMessageOf(fresh);
    if (!message) return;
    await this.notifier.updateSlack(
      action.tenantId,
      message.channel,
      message.ts,
      decisionMessage(
        this.ctx.messageContext(incident, this.notifier.dashboardUrl),
        fresh,
        outcome,
      ),
    );
  }
}
