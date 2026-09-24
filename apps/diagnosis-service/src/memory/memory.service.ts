import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  Action,
  AuditLog,
  Diagnosis,
  Incident,
  Postmortem,
  ResolutionPattern,
  Runbook,
} from '@sreai/database';
import { ActionStatus, ActionType, IncidentStatus, RUNBOOK_MIN_OCCURRENCES } from '@sreai/shared';
import { DataSource, In } from 'typeorm';
import { PostmortemStorage } from './postmortem-storage.service';
import { renderPostmortem } from './postmortem.template';
import { PreventionService } from './prevention.service';
import { renderRunbook } from './runbook.template';

const NO_ACTION = 'none';
const MAX_PATTERN_INCIDENTS = 50;

export interface MemoryOutcome {
  postmortemId: string | null;
  pattern: { actionType: string; occurrences: number; successes: number } | null;
  runbookId: string | null;
}

// Institutional memory, run once per resolved incident:
//   1. post-mortem (markdown in Postgres, copy to S3 when configured)
//   2. resolution pattern — "alert X on service Z, fixed by A, N/M times"
//   3. runbook, once the same fix has worked RUNBOOK_MIN_OCCURRENCES times
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly prevention: PreventionService,
    private readonly storage: PostmortemStorage,
  ) {}

  async process(tenantId: string, incidentId: string): Promise<MemoryOutcome> {
    const incident = await this.ds.getRepository(Incident).findOne({
      where: { tenantId, id: incidentId },
      relations: { service: true },
    });
    if (!incident || incident.status !== IncidentStatus.RESOLVED) {
      return { postmortemId: null, pattern: null, runbookId: null };
    }
    const [diagnosis, actions, timeline] = await Promise.all([
      this.ds
        .getRepository(Diagnosis)
        .findOne({ where: { tenantId, incidentId }, order: { createdAt: 'DESC' } }),
      this.ds
        .getRepository(Action)
        .find({ where: { tenantId, incidentId }, order: { createdAt: 'ASC' } }),
      this.ds
        .getRepository(AuditLog)
        .find({ where: { tenantId, incidentId }, order: { createdAt: 'ASC' } }),
    ]);
    const fix = this.effectiveFix(actions);
    const serviceName = incident.service?.name ?? 'unknown-service';

    const postmortemId = await this.writePostmortem(
      incident,
      serviceName,
      diagnosis,
      actions,
      timeline,
      fix,
    );
    // Test alerts and storm children don't teach anything.
    if (
      incident.labels?.sreai_test === 'true' ||
      incident.parentIncidentId ||
      !incident.fingerprint
    ) {
      return { postmortemId, pattern: null, runbookId: null };
    }
    const pattern = await this.recordPattern(incident, diagnosis, fix);
    const runbookId =
      pattern && pattern.actionType !== NO_ACTION && pattern.successes >= RUNBOOK_MIN_OCCURRENCES
        ? await this.writeRunbook(incident, serviceName, pattern)
        : null;

    this.logger.log('Incident memory recorded', {
      tenantId,
      incidentId,
      postmortemId,
      patternAction: pattern?.actionType ?? null,
      patternSuccesses: pattern?.successes ?? null,
      runbookId,
    });
    return {
      postmortemId,
      pattern: pattern
        ? {
            actionType: pattern.actionType,
            occurrences: pattern.occurrences,
            successes: pattern.successes,
          }
        : null,
      runbookId,
    };
  }

  // The action that resolved the incident: the last executed remediation
  // that wasn't rolled back.
  private effectiveFix(actions: Action[]): Action | null {
    return (
      [...actions]
        .reverse()
        .find(
          (a) =>
            a.status === ActionStatus.EXECUTED &&
            a.actionType !== ActionType.ESCALATE &&
            a.actionType !== ActionType.ROLLBACK &&
            a.actionType !== ActionType.NOTIFY,
        ) ?? null
    );
  }

  private async writePostmortem(
    incident: Incident,
    serviceName: string,
    diagnosis: Diagnosis | null,
    actions: Action[],
    timeline: AuditLog[],
    fix: Action | null,
  ): Promise<string> {
    const prevention = await this.prevention.suggest({
      title: incident.title,
      service: serviceName,
      rootCause: diagnosis?.hypothesis ?? null,
      fix: fix?.description ?? incident.resolutionNote,
    });
    const markdown = renderPostmortem({
      incident,
      serviceName,
      diagnosis,
      actions,
      timeline,
      prevention,
    });
    const storageKey = await this.storage.put(incident.tenantId, incident.id, markdown);

    await this.ds
      .createQueryBuilder()
      .insert()
      .into(Postmortem)
      .values({
        tenantId: incident.tenantId,
        incidentId: incident.id,
        markdown,
        prevention,
        storageKey,
      })
      .orUpdate(
        ['markdown', 'prevention', 'storage_key', 'updated_at'],
        ['tenant_id', 'incident_id'],
      )
      .execute();
    const row = await this.ds
      .getRepository(Postmortem)
      .findOneOrFail({
        where: { tenantId: incident.tenantId, incidentId: incident.id },
        select: { id: true },
      });
    return row.id;
  }

  // Idempotent per incident: a retried job never double-counts.
  private async recordPattern(
    incident: Incident,
    diagnosis: Diagnosis | null,
    fix: Action | null,
  ): Promise<ResolutionPattern | null> {
    const actionType = fix?.actionType ?? NO_ACTION;
    const signature = incident.fingerprint as string;
    const success = fix !== null;

    return this.ds.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `pattern:${incident.tenantId}:${signature}`,
      ]);
      const repo = m.getRepository(ResolutionPattern);
      let pattern = await repo.findOne({
        where: { tenantId: incident.tenantId, signature, actionType },
      });
      if (pattern?.incidentIds.includes(incident.id)) return pattern;

      if (!pattern) {
        pattern = repo.create({
          tenantId: incident.tenantId,
          serviceId: incident.serviceId,
          signature,
          alertTitle: incident.title.slice(0, 500),
          actionType,
          rootCause: diagnosis?.hypothesis ?? 'not recorded',
          occurrences: 0,
          successes: 0,
          incidentIds: [],
          lastSeenAt: new Date(),
        });
      }
      pattern.occurrences += 1;
      if (success) pattern.successes += 1;
      pattern.incidentIds = [...pattern.incidentIds, incident.id].slice(-MAX_PATTERN_INCIDENTS);
      pattern.lastSeenAt = new Date();
      if (diagnosis) pattern.rootCause = diagnosis.hypothesis;
      return repo.save(pattern);
    });
  }

  private async writeRunbook(
    incident: Incident,
    serviceName: string,
    pattern: ResolutionPattern,
  ): Promise<string> {
    const { tenantId } = incident;
    const [incidents, diagnoses, fixes, postmortems] = await Promise.all([
      this.ds.getRepository(Incident).find({
        where: { tenantId, id: In(pattern.incidentIds) },
        order: { detectedAt: 'DESC' },
      }),
      this.ds
        .getRepository(Diagnosis)
        .find({ where: { tenantId, incidentId: In(pattern.incidentIds) } }),
      this.ds.getRepository(Action).find({
        where: {
          tenantId,
          incidentId: In(pattern.incidentIds),
          actionType: pattern.actionType as ActionType,
          status: ActionStatus.EXECUTED,
        },
        order: { executedAt: 'DESC' },
      }),
      this.ds
        .getRepository(Postmortem)
        .find({ where: { tenantId, incidentId: In(pattern.incidentIds) } }),
    ]);
    const prevention = [...new Set(postmortems.flatMap((p) => p.prevention))].slice(0, 6);
    const markdown = renderRunbook({
      alertTitle: pattern.alertTitle,
      serviceName,
      actionType: pattern.actionType,
      actionDescription: fixes[0]?.description ?? pattern.actionType,
      incidents,
      diagnoses,
      prevention,
      successes: pattern.successes,
      occurrences: pattern.occurrences,
    });

    const repo = this.ds.getRepository(Runbook);
    const existing = await repo.findOne({ where: { tenantId, signature: pattern.signature } });
    const saved = await repo.save({
      ...(existing ?? {}),
      tenantId,
      serviceId: pattern.serviceId,
      signature: pattern.signature,
      title: `Runbook: ${pattern.alertTitle} on ${serviceName}`.slice(0, 500),
      markdown,
      incidentIds: pattern.incidentIds,
      version: existing ? existing.version + 1 : 1,
    });
    return saved.id;
  }
}
