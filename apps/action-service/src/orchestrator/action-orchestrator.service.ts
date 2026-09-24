import { Injectable, Logger } from '@nestjs/common';
import { Action, writeAuditLog } from '@sreai/database';
import {
  ActionCommand,
  ActionDecisionCommand,
  ActionStatus,
  ActionTier,
  ActionType,
  AuditActorType,
  DiagnosisCompletedCommand,
  DiagnosisFailedCommand,
  IncidentStatus,
  ManualActionCommand,
  RollbackRequestedCommand,
  mostConservativeTier,
  resolveThresholds,
  routeActionTier,
} from '@sreai/shared';
import { classifyRecommendedAction } from '../planning/action-planner';
import { NotifierService } from '../notify/notifier.service';
import { incidentOpenedMessage, resolvedMessage } from '../notify/slack-messages';
import { ActionExecutor } from './action-executor.service';
import { EscalationService } from './escalation.service';
import { IncidentContextService } from './incident-context.service';

// Routes every sreai-actions command. The heart of the confidence-gated
// action layer is onDiagnosis: tier = most conservative of the diagnosis
// tier and a fresh routing with this service's overrides, then
//   AUTO     → validate + execute an allowlisted handler, else fall to DRAFT
//   DRAFT    → pending action + Slack approval, else (nothing executable)
//              hand to a human without paging
//   ESCALATE → page on-call with the full context packet.
@Injectable()
export class ActionOrchestrator {
  private readonly logger = new Logger(ActionOrchestrator.name);

  constructor(
    private readonly ctx: IncidentContextService,
    private readonly executor: ActionExecutor,
    private readonly escalation: EscalationService,
    private readonly notifier: NotifierService,
  ) {}

  async handle(command: ActionCommand): Promise<void> {
    switch (command.kind) {
      case 'incident_opened':
        return this.onIncidentOpened(command.tenantId, command.incidentId);
      case 'diagnosis_completed':
        return this.onDiagnosis(command);
      case 'diagnosis_failed':
        return this.onDiagnosisFailed(command);
      case 'incident_resolved':
        return this.onResolved(command.tenantId, command.incidentId);
      case 'action_decision':
        return this.onDecision(command);
      case 'rollback_requested':
        return this.onRollback(command);
      case 'manual_action':
        return this.onManual(command);
    }
  }

  private async onIncidentOpened(tenantId: string, incidentId: string): Promise<void> {
    const incident = await this.ctx.loadIncident(tenantId, incidentId);
    if (!incident || this.ctx.slackThread(incident)) return;
    const posted = await this.notifier.postSlack(
      tenantId,
      incidentOpenedMessage(this.ctx.messageContext(incident, this.notifier.dashboardUrl)),
    );
    // Later messages for this incident thread under the opening one.
    if (posted) await this.ctx.mergeEnrichment(incident, { slack: posted });
  }

  private async onDiagnosis(cmd: DiagnosisCompletedCommand): Promise<void> {
    const { tenantId, incidentId, diagnosisId } = cmd;
    const incident = await this.ctx.loadIncident(tenantId, incidentId);
    if (!incident || this.ctx.isClosed(incident)) {
      this.logger.log('Diagnosis not acted on: incident closed or grouped', {
        tenantId,
        incidentId,
      });
      return;
    }
    const diagnosis = await this.ctx.loadDiagnosis(tenantId, diagnosisId);
    if (!diagnosis) {
      this.logger.error('Diagnosis not found for command', { tenantId, incidentId, diagnosisId });
      return;
    }

    // Redelivered command: this diagnosis has already been acted on.
    const alreadyHandled = await this.ctx.dataSource
      .getRepository(Action)
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId AND a.incident_id = :incidentId', { tenantId, incidentId })
      .andWhere(`a.payload->>'diagnosisId' = :diagnosisId`, { diagnosisId })
      .getCount();
    if (alreadyHandled > 0) {
      this.logger.log('Diagnosis already acted on — skipping duplicate command', {
        tenantId,
        incidentId,
        diagnosisId,
      });
      return;
    }

    if (this.ctx.isTestIncident(incident)) {
      await this.escalation.escalate({
        incident,
        diagnosis,
        reason: 'Test alert diagnosed end to end — no action taken',
        page: false,
      });
      return;
    }

    const settings = await this.ctx.settings(tenantId);
    const thresholds = resolveThresholds(settings.autoThreshold, settings.draftThreshold);
    let tier = mostConservativeTier(
      routeActionTier(diagnosis.confidence, thresholds, {
        alwaysEscalate: incident.service?.alwaysEscalate ?? false,
        autoExecuteEnabled: incident.service?.autoExecuteEnabled ?? false,
      }),
      diagnosis.actionTier,
    );

    const ctx = this.ctx.actionContext(incident, diagnosis);
    const classified = classifyRecommendedAction(diagnosis.recommendedAction);
    const handler = classified.type ? this.executor.handlerFor(classified.type) : null;
    const planned = handler ? handler.plan(ctx) : null;
    let note: string | null = classified.type
      ? planned
        ? null
        : `${incident.service?.name ?? 'service'} is not configured for ${classified.type}`
      : (classified.reason ?? 'no executable action');

    this.logger.log('Routing diagnosis', {
      tenantId,
      incidentId,
      confidence: diagnosis.confidence,
      tier,
      actionType: planned?.type ?? null,
      note,
    });

    if (tier === ActionTier.AUTO) {
      if (handler && planned) {
        const validation = await this.executor.safeValidate(handler, ctx, planned);
        if (validation.ok) {
          await this.executor.autoExecute(ctx, handler, planned);
          return;
        }
        note = validation.reason;
      }
      tier = ActionTier.DRAFT;
    }

    if (tier === ActionTier.DRAFT) {
      if (planned) {
        await this.executor.requestApproval(ctx, planned, note);
        return;
      }
      await this.escalation.escalate({
        incident,
        diagnosis,
        reason: `Diagnosis needs a human: ${note}`,
        page: false,
      });
      return;
    }

    await this.escalation.escalate({
      incident,
      diagnosis,
      reason: incident.service?.alwaysEscalate
        ? 'Service is configured to always escalate'
        : diagnosis.citationsPassed
          ? `Low confidence (${Math.round(diagnosis.confidence * 100)}%)`
          : 'Diagnosis failed citation verification',
      page: true,
    });
  }

  private async onDiagnosisFailed(cmd: DiagnosisFailedCommand): Promise<void> {
    const incident = await this.ctx.loadIncident(cmd.tenantId, cmd.incidentId);
    if (!incident || this.ctx.isClosed(incident)) return;
    await this.escalation.escalate({
      incident,
      diagnosis: null,
      reason: `Automated diagnosis failed (${cmd.reason.slice(0, 200)}) — raw alert attached`,
      page: true,
    });
  }

  private async onResolved(tenantId: string, incidentId: string): Promise<void> {
    const incident = await this.ctx.loadIncident(tenantId, incidentId);
    if (!incident) return;

    // Pending approvals are moot once the incident is resolved.
    const pending = await this.ctx.dataSource.getRepository(Action).find({
      where: { tenantId, incidentId, status: ActionStatus.PENDING },
    });
    for (const action of pending) {
      await this.ctx.dataSource.transaction(async (m) => {
        await m.update(
          Action,
          { tenantId, id: action.id, status: ActionStatus.PENDING },
          { status: ActionStatus.EXPIRED, error: 'incident resolved' },
        );
        await writeAuditLog(m, {
          tenantId,
          incidentId,
          actorType: AuditActorType.SYSTEM,
          event: 'action.expired',
          metadata: { actionId: action.id, reason: 'incident resolved' },
        });
      });
    }

    const actions = await this.ctx.dataSource.getRepository(Action).find({
      where: { tenantId, incidentId },
      order: { createdAt: 'DESC' },
    });
    if (actions.some((a) => a.actionType === ActionType.ESCALATE && a.result?.paged === true)) {
      await this.notifier.resolvePage(tenantId, incidentId);
    }
    const fix = actions.find(
      (a) =>
        a.status === ActionStatus.EXECUTED &&
        a.actionType !== ActionType.ESCALATE &&
        a.actionType !== ActionType.ROLLBACK,
    );
    const diagnosis = await this.ctx.latestDiagnosis(tenantId, incidentId);
    await this.notifier.postSlack(
      tenantId,
      resolvedMessage(
        this.ctx.messageContext(incident, this.notifier.dashboardUrl),
        diagnosis,
        fix?.description ?? null,
      ),
      this.ctx.slackThread(incident)?.ts,
    );
  }

  private onDecision(cmd: ActionDecisionCommand): Promise<void> {
    return this.executor.decide(
      cmd.tenantId,
      cmd.actionId,
      cmd.decision,
      {
        type: cmd.actorType === 'slack' ? AuditActorType.SLACK : AuditActorType.USER,
        id: cmd.actorId,
      },
      cmd.reason,
    );
  }

  private onRollback(cmd: RollbackRequestedCommand): Promise<void> {
    return this.executor.rollback(cmd.tenantId, cmd.actionId, {
      type: cmd.actorType === 'slack' ? AuditActorType.SLACK : AuditActorType.USER,
      id: cmd.actorId,
    });
  }

  private async onManual(cmd: ManualActionCommand): Promise<void> {
    const incident = await this.ctx.loadIncident(cmd.tenantId, cmd.incidentId);
    if (!incident || incident.status === IncidentStatus.RESOLVED) return;
    const actor = { type: AuditActorType.USER, id: cmd.userId };
    if (cmd.actionType === ActionType.ESCALATE) {
      await this.escalation.escalate({
        incident,
        diagnosis: await this.ctx.latestDiagnosis(cmd.tenantId, cmd.incidentId),
        reason: `Escalated manually${cmd.note ? `: ${cmd.note}` : ''}`,
        page: true,
        actorType: actor.type,
        actorId: actor.id,
      });
      return;
    }
    await this.executor.manual(incident, cmd.actionType, actor, cmd.note);
  }
}
