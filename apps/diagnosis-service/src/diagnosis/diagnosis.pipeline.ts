import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { CitationFailure, Diagnosis, Incident, Tenant, writeAuditLog } from '@sreai/database';
import { RealtimePublisher } from '@sreai/queue';
import {
  ActionTier,
  AuditActorType,
  IncidentStatus,
  ServiceMetadataSchema,
  mostConservativeTier,
  parseTenantSettings,
  resolveThresholds,
  routeActionTier,
} from '@sreai/shared';
import { DataSource } from 'typeorm';
import { ActionCommandPublisher } from '../common/action-command.publisher';
import { publishSafely } from '../common/realtime';
import { CitationValidator } from './citations/citation-validator';
import { ContextCollectorService } from './context/context-collector.service';
import { renderContext } from './context/context-renderer';
import { IncidentSnapshot } from './context/context.types';
import { DiagnosisAgent } from './llm/diagnosis-agent.service';
import { scoreConfidence } from './scoring/confidence-scorer';

export interface DiagnosisJobData {
  tenantId: string;
  incidentId: string;
  traceId: string;
}

export type PipelineOutcome = 'diagnosed' | 'handoff_resent' | 'skipped';

const OPEN_STATUSES = new Set([IncidentStatus.DETECTING, IncidentStatus.DIAGNOSING]);

// detecting → diagnosing → (context → LLM → citation enforcement →
// scoring) → acting, then hand the diagnosis to the action-service.
// Citation validation runs before anything downstream sees the diagnosis
// (CLAUDE.md rule #4).
@Injectable()
export class DiagnosisPipeline {
  private readonly logger = new Logger(DiagnosisPipeline.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly collector: ContextCollectorService,
    private readonly agent: DiagnosisAgent,
    private readonly validator: CitationValidator,
    private readonly commands: ActionCommandPublisher,
    private readonly realtime: RealtimePublisher,
  ) {}

  async run(job: DiagnosisJobData): Promise<PipelineOutcome> {
    const { tenantId, incidentId, traceId } = job;
    const incident = await this.dataSource.getRepository(Incident).findOne({
      where: { tenantId, id: incidentId },
      relations: { service: true },
    });
    if (!incident) {
      this.logger.warn('Diagnosis skipped: incident not found', { tenantId, incidentId });
      return 'skipped';
    }
    if (incident.parentIncidentId || incident.status === IncidentStatus.RESOLVED) {
      this.logger.log('Diagnosis skipped: incident grouped or already resolved', {
        tenantId,
        incidentId,
        status: incident.status,
        parentIncidentId: incident.parentIncidentId,
      });
      return 'skipped';
    }

    // Idempotent retry: a previous attempt committed the diagnosis (incident
    // is now ACTING) but died before the SQS handoff — resend it. The
    // action-service ignores a diagnosis it has already acted on.
    const existing = await this.dataSource.getRepository(Diagnosis).findOne({
      where: { tenantId, incidentId },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      if (incident.status === IncidentStatus.ACTING || OPEN_STATUSES.has(incident.status)) {
        await this.handoff(incident, existing, traceId);
        return 'handoff_resent';
      }
      return 'skipped';
    }

    await this.markDiagnosing(incident);

    const metadata = ServiceMetadataSchema.safeParse(incident.service?.metadata ?? {});
    const snapshot: IncidentSnapshot = {
      id: incident.id,
      tenantId,
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      serviceName: incident.service?.name ?? 'unknown-service',
      labels: incident.labels,
      detectedAt: incident.detectedAt,
      fingerprint: incident.fingerprint,
    };

    const { context, report } = await this.collector.collect({
      incident: snapshot,
      serviceId: incident.serviceId,
      metadata: metadata.success ? metadata.data : {},
    });
    const rendered = renderContext(context);
    const agentResult = await this.agent.diagnose(rendered.prompt);
    const citations = this.validator.validate(agentResult.output, rendered);
    const score = scoreConfidence(agentResult.output.confidence, citations, context);

    const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } });
    const settings = parseTenantSettings(tenant?.settings);
    const thresholds = resolveThresholds(settings.autoThreshold, settings.draftThreshold);
    const scoredTier = routeActionTier(score.final, thresholds, {
      alwaysEscalate: incident.service?.alwaysEscalate ?? false,
    });
    // The model may make the tier more cautious, never less.
    const tier = mostConservativeTier(scoredTier, agentResult.output.action_tier as ActionTier);

    this.logger.log('Diagnosis scored', {
      tenantId,
      incidentId,
      llmConfidence: agentResult.output.confidence,
      confidence: score.final,
      citationFailureRate: citations.failureRate,
      citationsPassed: citations.passed,
      tier,
    });

    const diagnosis = await this.dataSource.transaction(async (manager) => {
      // Lock the incident row so a concurrent resolution can't interleave.
      const current = await manager
        .getRepository(Incident)
        .createQueryBuilder('i')
        .setLock('pessimistic_write')
        .where('i.tenant_id = :tenantId AND i.id = :incidentId', { tenantId, incidentId })
        .getOne();

      const saved = await manager.save(
        Diagnosis,
        manager.create(Diagnosis, {
          tenantId,
          incidentId,
          hypothesis: agentResult.output.hypothesis,
          confidence: score.final,
          llmConfidence: agentResult.output.confidence,
          evidence: agentResult.output.evidence,
          recommendedAction: agentResult.output.recommended_action,
          actionTier: tier,
          reasoning: agentResult.output.reasoning,
          citationFailureRate: citations.failureRate,
          citationsPassed: citations.passed,
          contextUsed: {
            prompt: rendered.prompt,
            collectors: report,
            scoring: score,
            citationChecks: citations.checks,
            recentDeploy: context.recentDeploy,
            pattern: context.pattern,
          },
          similarIncidentIds: context.similarIncidents.map((s) => s.incidentId),
          model: agentResult.model,
          promptVersion: agentResult.promptVersion,
          tokenUsage: agentResult.tokenUsage,
          latencyMs: agentResult.latencyMs,
        }),
      );

      const failures = citations.checks.filter((c) => !c.valid);
      if (failures.length > 0) {
        await manager.save(
          CitationFailure,
          failures.map((f) =>
            manager.create(CitationFailure, {
              tenantId,
              diagnosisId: saved.id,
              claim: f.claim.slice(0, 2000),
              source: f.source.slice(0, 50),
              reference: f.reference.slice(0, 2000),
              failureReason: f.foundIn
                ? `${f.reason} (found in ${f.foundIn})`
                : (f.reason ?? 'invalid'),
            }),
          ),
        );
      }

      // Resolved meanwhile: keep the diagnosis (post-mortem material) but
      // don't move the incident backwards or trigger actions.
      if (current && OPEN_STATUSES.has(current.status)) {
        await manager.update(
          Incident,
          { tenantId, id: incidentId },
          { status: IncidentStatus.ACTING },
        );
      }
      await writeAuditLog(manager, {
        tenantId,
        incidentId,
        actorType: AuditActorType.SYSTEM,
        event: 'diagnosis.completed',
        before: { status: current?.status ?? null },
        after: {
          status:
            current && OPEN_STATUSES.has(current.status)
              ? IncidentStatus.ACTING
              : (current?.status ?? null),
          diagnosisId: saved.id,
          confidence: score.final,
          tier,
        },
        metadata: { citationFailureRate: citations.failureRate, citationsPassed: citations.passed },
      });
      return { saved, stillOpen: Boolean(current && OPEN_STATUSES.has(current.status)) };
    });

    if (diagnosis.stillOpen) {
      await this.handoff({ ...incident, status: IncidentStatus.ACTING }, diagnosis.saved, traceId);
    }
    await publishSafely(this.realtime, {
      tenantId,
      incidentId,
      type: 'diagnosis.completed',
      status: diagnosis.stillOpen ? IncidentStatus.ACTING : undefined,
      payload: { diagnosisId: diagnosis.saved.id, confidence: score.final, tier },
    });
    return 'diagnosed';
  }

  private async markDiagnosing(incident: Incident): Promise<void> {
    if (incident.status !== IncidentStatus.DETECTING) return;
    await this.dataSource.transaction(async (manager) => {
      const res = await manager.update(
        Incident,
        { tenantId: incident.tenantId, id: incident.id, status: IncidentStatus.DETECTING },
        { status: IncidentStatus.DIAGNOSING },
      );
      if (!res.affected) return;
      await writeAuditLog(manager, {
        tenantId: incident.tenantId,
        incidentId: incident.id,
        actorType: AuditActorType.SYSTEM,
        event: 'incident.status_changed',
        before: { status: IncidentStatus.DETECTING },
        after: { status: IncidentStatus.DIAGNOSING },
      });
    });
    await publishSafely(this.realtime, {
      tenantId: incident.tenantId,
      incidentId: incident.id,
      type: 'incident.updated',
      status: IncidentStatus.DIAGNOSING,
    });
  }

  private async handoff(incident: Incident, diagnosis: Diagnosis, traceId: string): Promise<void> {
    await this.commands.send({
      kind: 'diagnosis_completed',
      traceId,
      tenantId: incident.tenantId,
      incidentId: incident.id,
      diagnosisId: diagnosis.id,
    });
  }
}
