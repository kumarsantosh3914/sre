import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Incident, MonitoredService, writeAuditLog } from '@sreai/database';
import { RealtimePublisher } from '@sreai/queue';
import {
  AlertMessage,
  AuditActorType,
  IncidentQueueMessage,
  IncidentSeverity,
  IncidentStatus,
  ManualResolveMessage,
  NormalizedAlert,
  STORM_WINDOW_SECONDS,
  ServiceMetadataSchema,
  computeAlertFingerprint,
} from '@sreai/shared';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { ActionCommandPublisher } from '../common/action-command.publisher';
import { publishSafely } from '../common/realtime';
import { DiagnosisQueue } from '../diagnosis/diagnosis.queue';
import { ResolutionHooks } from './resolution-hooks';

const OPEN_STATUSES = [
  IncidentStatus.DETECTING,
  IncidentStatus.DIAGNOSING,
  IncidentStatus.ACTING,
  IncidentStatus.ESCALATED,
];
const MAX_STORM_ALERT_TITLES = 50;

interface IntakeResult {
  incident: Incident;
  created: boolean;
  needsDiagnosis: boolean;
  groupedIds?: string[];
}

// Consumes sreai-incidents-p1/p2 and owns incident creation/resolution.
// Every path is idempotent under SQS redelivery (ingest_key uniqueness),
// serialised per fingerprint (advisory lock), and writes its audit row in
// the same transaction as the state change.
@Injectable()
export class IncidentIntakeService {
  private readonly logger = new Logger(IncidentIntakeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly diagnosisQueue: DiagnosisQueue,
    private readonly commands: ActionCommandPublisher,
    private readonly realtime: RealtimePublisher,
    private readonly hooks: ResolutionHooks,
  ) {}

  async handle(message: IncidentQueueMessage): Promise<void> {
    if (message.kind === 'manual_resolve') {
      return this.handleManualResolve(message);
    }
    const { alert } = message;
    if (alert.status === 'resolved') {
      return this.resolveByFingerprint(alert, message.traceId);
    }
    if (alert.stormKey) {
      return this.handleStormAlert(message);
    }
    return this.handleFiring(message);
  }

  // ---------- firing ----------

  private async handleFiring({ alert, traceId }: AlertMessage): Promise<void> {
    const result = await this.dataSource.transaction(async (m): Promise<IntakeResult> => {
      await this.lock(m, `${alert.tenantId}:${alert.fingerprint}`);
      const service = await this.upsertService(m, alert.tenantId, alert.serviceName);

      const redelivered = await m.findOne(Incident, {
        where: { tenantId: alert.tenantId, ingestKey: alert.alertId },
      });
      if (redelivered) {
        return {
          incident: redelivered,
          created: false,
          needsDiagnosis: redelivered.status === IncidentStatus.DETECTING,
        };
      }

      const open = await m.findOne(Incident, {
        where: {
          tenantId: alert.tenantId,
          fingerprint: alert.fingerprint,
          status: In(OPEN_STATUSES),
          parentIncidentId: IsNull(),
        },
        order: { detectedAt: 'DESC' },
      });
      if (open) {
        await this.attachAlert(m, open, alert);
        return { incident: open, created: false, needsDiagnosis: false };
      }

      const incident = await m.save(
        Incident,
        m.create(Incident, {
          tenantId: alert.tenantId,
          serviceId: service.id,
          severity: alert.severity,
          status: IncidentStatus.DETECTING,
          title: alert.title,
          description: alert.description,
          alertSource: alert.source,
          fingerprint: alert.fingerprint,
          ingestKey: alert.alertId,
          labels: alert.labels,
          enrichment: this.enrichment(service),
          alertCount: 1,
          lastAlertAt: new Date(alert.firedAt),
          sourceAlert: alert.rawPayload,
          detectedAt: new Date(alert.firedAt),
        }),
      );
      await writeAuditLog(m, {
        tenantId: alert.tenantId,
        incidentId: incident.id,
        actorType: AuditActorType.SYSTEM,
        event: 'incident.created',
        after: { status: incident.status, severity: incident.severity, title: incident.title },
        metadata: { source: alert.source, alertId: alert.alertId, service: service.name },
      });
      return { incident, created: true, needsDiagnosis: true };
    });

    await this.afterIntake(result, traceId);
  }

  // ---------- storms ----------

  private async handleStormAlert({ alert, traceId }: AlertMessage): Promise<void> {
    const stormKey = alert.stormKey as string;
    const result = await this.dataSource.transaction(async (m): Promise<IntakeResult> => {
      await this.lock(m, `${alert.tenantId}:${stormKey}`);
      const service = await this.upsertService(m, alert.tenantId, alert.serviceName);

      const existing = await m.findOne(Incident, {
        where: { tenantId: alert.tenantId, ingestKey: stormKey },
      });
      if (existing) {
        if (!alert.isStormSummary) await this.attachAlert(m, existing, alert);
        return { incident: existing, created: false, needsDiagnosis: false };
      }

      // Whichever of the summary or a grouped alert arrives first opens the
      // storm incident; the title is the same either way.
      const title = `Alert storm on ${service.name}`;
      const storm = await m.save(
        Incident,
        m.create(Incident, {
          tenantId: alert.tenantId,
          serviceId: service.id,
          severity: IncidentSeverity.P1,
          status: IncidentStatus.DETECTING,
          title,
          description:
            alert.isStormSummary && alert.description
              ? alert.description
              : `Alert storm detected on ${service.name}; related alerts are grouped into this incident.`,
          alertSource: alert.source,
          fingerprint: computeAlertFingerprint(alert.tenantId, service.name, title),
          ingestKey: stormKey,
          labels: { alertname: 'AlertStorm', service: service.name },
          enrichment: {
            ...this.enrichment(service),
            stormAlerts: alert.isStormSummary ? [] : [alert.title],
          },
          alertCount: 1,
          lastAlertAt: new Date(alert.firedAt),
          sourceAlert: alert.rawPayload,
          detectedAt: new Date(alert.firedAt),
        }),
      );

      // Fold in the incidents this service opened just before the storm
      // threshold tripped: one storm, one incident. Any open status — a fast
      // diagnosis may already have moved them on; the action layer ignores
      // grouped incidents.
      const since = new Date(Date.now() - 2 * STORM_WINDOW_SECONDS * 1000);
      const grouped = await m
        .createQueryBuilder()
        .update(Incident)
        .set({ parentIncidentId: storm.id })
        .where('tenant_id = :tenantId', { tenantId: alert.tenantId })
        .andWhere('service_id = :serviceId', { serviceId: service.id })
        .andWhere('id <> :stormId', { stormId: storm.id })
        .andWhere('parent_incident_id IS NULL')
        .andWhere('status IN (:...statuses)', { statuses: OPEN_STATUSES })
        .andWhere('created_at >= :since', { since })
        .returning(['id'])
        .execute();
      const groupedIds = (grouped.raw as { id: string }[]).map((r) => r.id);

      await writeAuditLog(m, {
        tenantId: alert.tenantId,
        incidentId: storm.id,
        actorType: AuditActorType.SYSTEM,
        event: 'incident.storm_opened',
        after: { status: storm.status, severity: storm.severity },
        metadata: { stormKey, groupedIncidentIds: groupedIds, service: service.name },
      });
      return { incident: storm, created: true, needsDiagnosis: true, groupedIds };
    });

    for (const id of result.groupedIds ?? []) {
      await this.diagnosisQueue.cancel(id);
    }
    if (result.groupedIds?.length) {
      this.logger.warn('Alert storm grouped existing incidents', {
        tenantId: alert.tenantId,
        stormIncidentId: result.incident.id,
        grouped: result.groupedIds.length,
      });
    }
    await this.afterIntake(result, traceId);
  }

  private async attachAlert(
    m: EntityManager,
    incident: Incident,
    alert: NormalizedAlert,
  ): Promise<void> {
    const enrichment = { ...incident.enrichment };
    if (alert.stormKey) {
      const titles = Array.isArray(enrichment.stormAlerts)
        ? (enrichment.stormAlerts as string[])
        : [];
      if (titles.length < MAX_STORM_ALERT_TITLES && !titles.includes(alert.title)) {
        enrichment.stormAlerts = [...titles, alert.title];
      }
    }
    // Query builder: TypeORM's update() typing can't express a jsonb
    // Record<string, unknown>; the value is still a bound parameter.
    await m
      .createQueryBuilder()
      .update(Incident)
      .set({
        alertCount: () => 'alert_count + 1',
        lastAlertAt: new Date(alert.firedAt),
        enrichment: () => ':enrichment::jsonb',
      })
      .setParameter('enrichment', JSON.stringify(enrichment))
      .where('tenant_id = :tenantId AND id = :id', { tenantId: incident.tenantId, id: incident.id })
      .execute();
    this.logger.log('Alert attached to open incident', {
      tenantId: incident.tenantId,
      incidentId: incident.id,
      alertId: alert.alertId,
    });
  }

  private async afterIntake(result: IntakeResult, traceId: string): Promise<void> {
    const { incident } = result;
    if (result.needsDiagnosis) {
      await this.diagnosisQueue.enqueue(
        { tenantId: incident.tenantId, incidentId: incident.id, traceId },
        incident.severity,
      );
    }
    if (result.created) {
      this.logger.log('Incident opened', {
        tenantId: incident.tenantId,
        incidentId: incident.id,
        severity: incident.severity,
      });
      await this.commands.send({
        kind: 'incident_opened',
        traceId,
        tenantId: incident.tenantId,
        incidentId: incident.id,
      });
    }
    await publishSafely(this.realtime, {
      tenantId: incident.tenantId,
      incidentId: incident.id,
      type: result.created ? 'incident.created' : 'incident.updated',
      status: incident.status,
    });
  }

  // ---------- resolution ----------

  private async resolveByFingerprint(alert: NormalizedAlert, traceId: string): Promise<void> {
    const resolved = await this.dataSource.transaction(async (m) => {
      await this.lock(m, `${alert.tenantId}:${alert.fingerprint}`);
      const open = await m.findOne(Incident, {
        where: {
          tenantId: alert.tenantId,
          fingerprint: alert.fingerprint,
          status: Not(IncidentStatus.RESOLVED),
        },
        order: { detectedAt: 'DESC' },
      });
      if (!open) return null;
      const at = alert.resolvedAt ? new Date(alert.resolvedAt) : new Date();
      return this.markResolved(m, open, at, {
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        resolvedBy: null,
        note: null,
        via: `${alert.source} alert resolved`,
      });
    });
    if (!resolved) {
      this.logger.log('Resolution for an alert with no open incident — ignored', {
        tenantId: alert.tenantId,
        fingerprint: alert.fingerprint,
      });
      return;
    }
    await this.afterResolved(resolved, traceId);
  }

  private async handleManualResolve(msg: ManualResolveMessage): Promise<void> {
    const resolved = await this.dataSource.transaction(async (m) => {
      const incident = await m.findOne(Incident, {
        where: { tenantId: msg.tenantId, id: msg.incidentId },
      });
      if (!incident || incident.status === IncidentStatus.RESOLVED) return null;
      await this.lock(m, `${msg.tenantId}:${incident.fingerprint ?? incident.id}`);
      return this.markResolved(m, incident, new Date(), {
        actorType: AuditActorType.USER,
        actorId: msg.userId,
        resolvedBy: msg.userId,
        note: msg.note,
        via: 'manual',
      });
    });
    if (resolved) await this.afterResolved(resolved, msg.traceId);
  }

  private async markResolved(
    m: EntityManager,
    incident: Incident,
    at: Date,
    by: {
      actorType: AuditActorType;
      actorId: string | null;
      resolvedBy: string | null;
      note: string | null;
      via: string;
    },
  ): Promise<Incident> {
    // An alert's own resolution timestamp can predate our detection clock
    // skew; MTTR is never negative.
    const resolvedAt = at.getTime() < incident.detectedAt.getTime() ? incident.detectedAt : at;
    const mttrSeconds = Math.round((resolvedAt.getTime() - incident.detectedAt.getTime()) / 1000);
    await m.update(
      Incident,
      { tenantId: incident.tenantId, id: incident.id },
      {
        status: IncidentStatus.RESOLVED,
        resolvedAt,
        mttrSeconds,
        resolvedBy: by.resolvedBy,
        resolutionNote: by.note,
      },
    );
    await writeAuditLog(m, {
      tenantId: incident.tenantId,
      incidentId: incident.id,
      actorType: by.actorType,
      actorId: by.actorId,
      event: 'incident.resolved',
      before: { status: incident.status },
      after: { status: IncidentStatus.RESOLVED, mttrSeconds },
      metadata: { via: by.via, ...(by.note ? { note: by.note } : {}) },
    });
    return { ...incident, status: IncidentStatus.RESOLVED, resolvedAt, mttrSeconds };
  }

  private async afterResolved(incident: Incident, traceId: string): Promise<void> {
    this.logger.log('Incident resolved', {
      tenantId: incident.tenantId,
      incidentId: incident.id,
      mttrSeconds: incident.mttrSeconds,
    });
    await this.diagnosisQueue.cancel(incident.id);
    await this.commands.send({
      kind: 'incident_resolved',
      traceId,
      tenantId: incident.tenantId,
      incidentId: incident.id,
    });
    await this.hooks.onResolved(incident, traceId);
    await publishSafely(this.realtime, {
      tenantId: incident.tenantId,
      incidentId: incident.id,
      type: 'incident.updated',
      status: IncidentStatus.RESOLVED,
      payload: { mttrSeconds: incident.mttrSeconds },
    });
  }

  // ---------- helpers ----------

  private async lock(m: EntityManager, key: string): Promise<void> {
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  }

  private async upsertService(
    m: EntityManager,
    tenantId: string,
    name: string,
  ): Promise<MonitoredService> {
    await m
      .createQueryBuilder()
      .insert()
      .into(MonitoredService)
      .values({ tenantId, name })
      .orIgnore()
      .execute();
    return m.findOneOrFail(MonitoredService, { where: { tenantId, name } });
  }

  // Alert enrichment: service ownership/runbook metadata attached to the
  // incident up front, so escalations carry it even if diagnosis fails.
  private enrichment(service: MonitoredService): Record<string, unknown> {
    const metadata = ServiceMetadataSchema.safeParse(service.metadata ?? {});
    if (!metadata.success) return {};
    const { owner, repo, runbookUrl } = metadata.data;
    return {
      ...(owner ? { owner } : {}),
      ...(repo ? { repo } : {}),
      ...(runbookUrl ? { runbookUrl } : {}),
    };
  }
}
