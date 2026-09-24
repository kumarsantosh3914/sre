import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  Action,
  AuditLog,
  CitationFailure,
  Diagnosis,
  Incident,
  Postmortem,
} from '@sreai/database';
import {
  ActionStatus,
  ActionTier,
  IncidentStatus,
  REVERSIBLE_ACTION_TYPES,
  ROLLBACK_WINDOW_MS,
  getTraceContext,
  newTraceId,
} from '@sreai/shared';
import { DataSource, In } from 'typeorm';
import { CommandBus } from '../common/command-bus.service';
import { Page } from '../common/pagination';
import { ListIncidentsQueryDto, ManualActionDto } from './dto/incident.dto';
import { actionView, auditView, diagnosisView, incidentSummary } from './incident.views';

function traceId(): string {
  return getTraceContext()?.traceId ?? newTraceId();
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly commands: CommandBus,
  ) {}

  async list(
    tenantId: string,
    q: ListIncidentsQueryDto,
  ): Promise<Page<ReturnType<typeof incidentSummary>>> {
    const qb = this.ds
      .getRepository(Incident)
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.service', 's')
      .where('i.tenant_id = :tenantId', { tenantId });
    if (!q.includeGrouped) qb.andWhere('i.parent_incident_id IS NULL');
    if (q.status?.length) qb.andWhere('i.status IN (:...status)', { status: q.status });
    if (q.severity?.length) qb.andWhere('i.severity IN (:...severity)', { severity: q.severity });
    if (q.serviceId) qb.andWhere('i.service_id = :serviceId', { serviceId: q.serviceId });
    if (q.from) qb.andWhere('i.detected_at >= :from', { from: q.from });
    if (q.to) qb.andWhere('i.detected_at < :to', { to: q.to });
    if (q.search) {
      qb.andWhere('i.title ILIKE :search', { search: `%${q.search.replace(/[%_\\]/g, '\\$&')}%` });
    }
    // Property path, not column name: TypeORM's paginated join query
    // resolves ORDER BY through entity metadata.
    qb.orderBy('i.detectedAt', 'DESC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);

    const [incidents, total] = await qb.getManyAndCount();
    const latest = await this.latestDiagnoses(
      tenantId,
      incidents.map((i) => i.id),
    );
    return {
      items: incidents.map((i) => incidentSummary(i, latest.get(i.id))),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(tenantId: string, id: string) {
    const incident = await this.find(tenantId, id);
    const [diagnoses, actions, children, postmortem] = await Promise.all([
      this.ds
        .getRepository(Diagnosis)
        .find({ where: { tenantId, incidentId: id }, order: { createdAt: 'DESC' } }),
      this.ds
        .getRepository(Action)
        .find({ where: { tenantId, incidentId: id }, order: { createdAt: 'ASC' } }),
      this.ds.getRepository(Incident).find({
        where: { tenantId, parentIncidentId: id },
        relations: { service: true },
        order: { detectedAt: 'ASC' },
      }),
      this.ds
        .getRepository(Postmortem)
        .findOne({ where: { tenantId, incidentId: id }, select: { id: true } }),
    ]);
    const failures = diagnoses[0]
      ? await this.ds
          .getRepository(CitationFailure)
          .find({ where: { tenantId, diagnosisId: diagnoses[0].id } })
      : [];
    const similarIds = diagnoses[0]?.similarIncidentIds ?? [];
    const similar = similarIds.length
      ? await this.ds
          .getRepository(Incident)
          .find({ where: { tenantId, id: In(similarIds) }, relations: { service: true } })
      : [];

    return {
      ...incidentSummary(incident, diagnoses[0]),
      description: incident.description,
      labels: incident.labels,
      enrichment: incident.enrichment,
      sourceAlert: incident.sourceAlert,
      resolutionNote: incident.resolutionNote,
      diagnosis: diagnoses[0] ? diagnosisView(diagnoses[0], failures) : null,
      previousDiagnoses: diagnoses.slice(1).map((d) => diagnosisView(d)),
      actions: actions.map(actionView),
      groupedIncidents: children.map((c) => incidentSummary(c)),
      similarIncidents: similar.map((s) => incidentSummary(s)),
      hasPostmortem: Boolean(postmortem),
    };
  }

  async diagnosis(tenantId: string, id: string) {
    await this.find(tenantId, id);
    const latest = await this.ds
      .getRepository(Diagnosis)
      .findOne({ where: { tenantId, incidentId: id }, order: { createdAt: 'DESC' } });
    if (!latest) throw new NotFoundException('Incident has not been diagnosed yet');
    const failures = await this.ds
      .getRepository(CitationFailure)
      .find({ where: { tenantId, diagnosisId: latest.id } });
    return diagnosisView(latest, failures);
  }

  async auditLog(tenantId: string, id: string): Promise<AuditLog[]> {
    await this.find(tenantId, id);
    return this.ds.getRepository(AuditLog).find({
      where: { tenantId, incidentId: id },
      order: { createdAt: 'ASC' },
    });
  }

  async timeline(tenantId: string, id: string) {
    return (await this.auditLog(tenantId, id)).map(auditView);
  }

  async resolve(tenantId: string, id: string, userId: string, note: string | null): Promise<void> {
    const incident = await this.find(tenantId, id);
    if (incident.status === IncidentStatus.RESOLVED)
      throw new ConflictException('Incident is already resolved');
    await this.commands.incident({
      kind: 'manual_resolve',
      traceId: traceId(),
      tenantId,
      incidentId: id,
      userId,
      note,
    });
  }

  async manualAction(
    tenantId: string,
    id: string,
    userId: string,
    dto: ManualActionDto,
  ): Promise<void> {
    const incident = await this.find(tenantId, id);
    if (incident.status === IncidentStatus.RESOLVED)
      throw new ConflictException('Incident is already resolved');
    await this.commands.action({
      kind: 'manual_action',
      traceId: traceId(),
      tenantId,
      incidentId: id,
      actionType: dto.actionType,
      userId,
      note: dto.note ?? null,
    });
  }

  async decide(
    tenantId: string,
    incidentId: string,
    actionId: string,
    userId: string,
    decision: 'approve' | 'reject',
    reason: string | null,
  ): Promise<void> {
    const action = await this.findAction(tenantId, incidentId, actionId);
    if (action.status !== ActionStatus.PENDING || action.tier !== ActionTier.DRAFT) {
      throw new ConflictException(`Action is ${action.status}, not awaiting approval`);
    }
    if (action.expiresAt && action.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Approval window has expired');
    }
    await this.commands.action({
      kind: 'action_decision',
      traceId: traceId(),
      tenantId,
      incidentId,
      actionId,
      decision,
      actorType: 'user',
      actorId: userId,
      reason,
    });
  }

  async rollback(
    tenantId: string,
    incidentId: string,
    actionId: string | null,
    userId: string,
  ): Promise<string> {
    let action: Action;
    if (actionId) {
      action = await this.findAction(tenantId, incidentId, actionId);
    } else {
      // "Roll back the last auto-executed action."
      const last = await this.ds.getRepository(Action).findOne({
        where: { tenantId, incidentId, tier: ActionTier.AUTO, status: ActionStatus.EXECUTED },
        order: { executedAt: 'DESC' },
      });
      if (!last) throw new NotFoundException('No auto-executed action to roll back');
      action = last;
    }
    if (action.status !== ActionStatus.EXECUTED || !action.executedAt) {
      throw new ConflictException(`Action is ${action.status}, not executed`);
    }
    if (Date.now() - action.executedAt.getTime() > ROLLBACK_WINDOW_MS) {
      throw new ConflictException('Rollback window (1 hour) has passed');
    }
    if (!REVERSIBLE_ACTION_TYPES.includes(action.actionType)) {
      throw new UnprocessableEntityException(`${action.actionType} actions are not reversible`);
    }
    await this.commands.action({
      kind: 'rollback_requested',
      traceId: traceId(),
      tenantId,
      incidentId,
      actionId: action.id,
      actorType: 'user',
      actorId: userId,
    });
    return action.id;
  }

  async find(tenantId: string, id: string): Promise<Incident> {
    const incident = await this.ds
      .getRepository(Incident)
      .findOne({ where: { tenantId, id }, relations: { service: true } });
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  private async findAction(
    tenantId: string,
    incidentId: string,
    actionId: string,
  ): Promise<Action> {
    const action = await this.ds
      .getRepository(Action)
      .findOne({ where: { tenantId, incidentId, id: actionId } });
    if (!action) throw new NotFoundException('Action not found');
    return action;
  }

  private async latestDiagnoses(
    tenantId: string,
    incidentIds: string[],
  ): Promise<Map<string, Diagnosis>> {
    if (incidentIds.length === 0) return new Map();
    const rows = await this.ds
      .getRepository(Diagnosis)
      .createQueryBuilder('d')
      .distinctOn(['d.incident_id'])
      .where('d.tenant_id = :tenantId AND d.incident_id IN (:...ids)', {
        tenantId,
        ids: incidentIds,
      })
      .orderBy('d.incident_id')
      .addOrderBy('d.created_at', 'DESC')
      .getMany();
    return new Map(rows.map((d) => [d.incidentId, d]));
  }
}
