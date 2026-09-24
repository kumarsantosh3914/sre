import { Injectable, Logger } from '@nestjs/common';
import { Action, Diagnosis, Incident, Runbook, writeAuditLog } from '@sreai/database';
import {
  ActionStatus,
  ActionTier,
  ActionType,
  AuditActorType,
  IncidentStatus,
} from '@sreai/shared';
import { In, MoreThan } from 'typeorm';
import { NotifierService } from '../notify/notifier.service';
import { shouldPage } from '../notify/silence';
import { EscalationPacket, escalationMessage } from '../notify/slack-messages';
import { IncidentContextService } from './incident-context.service';

export interface EscalationRequest {
  incident: Incident;
  diagnosis: Diagnosis | null;
  reason: string;
  // false for "a human should look" without waking anyone (medium
  // confidence, nothing executable). Still pages if Slack isn't set up —
  // an escalation must reach someone.
  page: boolean;
  actorType?: AuditActorType;
  actorId?: string | null;
}

// Collapses bursts of escalations for one incident (e.g. a rejected
// approval right after a failed action) into one page.
const DUPLICATE_WINDOW_MS = 10 * 60_000;

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private readonly ctx: IncidentContextService,
    private readonly notifier: NotifierService,
  ) {}

  async escalate(req: EscalationRequest): Promise<void> {
    const { incident, diagnosis } = req;
    const { tenantId } = incident;
    const repo = this.ctx.dataSource.getRepository(Action);

    const recent = await repo.findOne({
      where: {
        tenantId,
        incidentId: incident.id,
        actionType: ActionType.ESCALATE,
        createdAt: MoreThan(new Date(Date.now() - DUPLICATE_WINDOW_MS)),
      },
    });
    if (recent) {
      this.logger.log('Escalation already sent recently — not paging again', {
        tenantId,
        incidentId: incident.id,
        reason: req.reason,
      });
      return;
    }

    const settings = await this.ctx.settings(tenantId);
    const slackTarget = await this.notifier.slackTarget(tenantId);
    const wantsPage = !this.ctx.isTestIncident(incident) && (req.page || !slackTarget);
    const silenced =
      wantsPage &&
      !shouldPage(incident.severity, new Date(), settings.timezone, settings.silenceWindows);

    // PagerDuty first: it's idempotent on dedup_key, and if it fails the
    // command is retried before anything is written.
    let paged = false;
    if (wantsPage && !silenced) {
      paged = await this.notifier.page(tenantId, {
        dedupKey: incident.id,
        summary: `[${incident.severity.toUpperCase()}] ${incident.title}${diagnosis ? ` — ${diagnosis.hypothesis}` : ''}`,
        source: incident.service?.name ?? 'sre-ai',
        severity: incident.severity,
        component: incident.service?.name,
        customDetails: {
          reason: req.reason,
          hypothesis: diagnosis?.hypothesis ?? null,
          confidence: diagnosis?.confidence ?? null,
          citationsPassed: diagnosis?.citationsPassed ?? null,
          recommendedAction: diagnosis?.recommendedAction ?? null,
          evidence: diagnosis?.evidence.slice(0, 5) ?? [],
          description: incident.description,
          labels: incident.labels,
        },
        ...(this.notifier.dashboardUrl
          ? {
              link: {
                href: `${this.notifier.dashboardUrl}/incidents/${incident.id}`,
                text: 'Open in SRE.ai',
              },
            }
          : {}),
      });
    }

    const action = await this.ctx.dataSource.transaction(async (m) => {
      const saved = await m.save(
        Action,
        m.create(Action, {
          tenantId,
          incidentId: incident.id,
          tier: ActionTier.ESCALATE,
          actionType: ActionType.ESCALATE,
          status: ActionStatus.EXECUTED,
          description: `Escalated to on-call: ${req.reason}`,
          payload: { reason: req.reason, diagnosisId: diagnosis?.id ?? null },
          result: { paged, silenced, slack: Boolean(slackTarget) },
          requestedBy: req.actorId ? `${req.actorType}:${req.actorId}` : 'system',
          executedAt: new Date(),
        }),
      );
      const moved = await m.update(
        Incident,
        {
          tenantId,
          id: incident.id,
          status: In([IncidentStatus.DETECTING, IncidentStatus.DIAGNOSING, IncidentStatus.ACTING]),
        },
        { status: IncidentStatus.ESCALATED },
      );
      await writeAuditLog(m, {
        tenantId,
        incidentId: incident.id,
        actorType: req.actorType ?? AuditActorType.SYSTEM,
        actorId: req.actorId ?? null,
        event: 'incident.escalated',
        before: { status: incident.status },
        after: { status: moved.affected ? IncidentStatus.ESCALATED : incident.status },
        metadata: { reason: req.reason, paged, silenced, actionId: saved.id },
      });
      return saved;
    });

    const posted = await this.notifier.postSlack(
      tenantId,
      escalationMessage(
        this.ctx.messageContext(incident, this.notifier.dashboardUrl),
        await this.packet(req),
      ),
      this.ctx.slackThread(incident)?.ts,
    );

    if (!paged && !posted && !silenced) {
      this.logger.error('Escalation could not be delivered: no PagerDuty or Slack configured', {
        tenantId,
        incidentId: incident.id,
      });
      await writeAuditLog(this.ctx.dataSource.manager, {
        tenantId,
        incidentId: incident.id,
        actorType: AuditActorType.SYSTEM,
        event: 'escalation.undeliverable',
        metadata: { reason: req.reason },
      });
    }

    this.logger.warn('Incident escalated', {
      tenantId,
      incidentId: incident.id,
      reason: req.reason,
      paged,
      silenced,
      slack: Boolean(posted),
    });
    await this.ctx.publish({
      tenantId,
      incidentId: incident.id,
      type: 'incident.updated',
      status: IncidentStatus.ESCALATED,
      payload: { actionId: action.id },
    });
  }

  private async packet(req: EscalationRequest): Promise<EscalationPacket> {
    const { incident, diagnosis } = req;
    const similarIds = diagnosis?.similarIncidentIds ?? [];
    const similar = similarIds.length
      ? await this.ctx.dataSource.getRepository(Incident).find({
          where: { tenantId: incident.tenantId, id: In(similarIds) },
        })
      : [];
    const fixes = similarIds.length
      ? await this.ctx.dataSource.getRepository(Action).find({
          where: {
            tenantId: incident.tenantId,
            incidentId: In(similarIds),
            status: ActionStatus.EXECUTED,
          },
        })
      : [];
    const runbook = incident.fingerprint
      ? await this.ctx.dataSource
          .getRepository(Runbook)
          .findOne({ where: { tenantId: incident.tenantId, signature: incident.fingerprint } })
      : null;
    return {
      reason: req.reason,
      diagnosis,
      similar: similar.map((s) => ({
        title: s.title,
        mttrSeconds: s.mttrSeconds,
        actionTaken:
          fixes.find((f) => f.incidentId === s.id && f.actionType !== ActionType.ESCALATE)
            ?.description ?? null,
      })),
      runbookTitle: runbook?.title ?? null,
      enrichment: incident.enrichment ?? {},
    };
  }
}
