import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Action, Diagnosis, Incident, Tenant } from '@sreai/database';
import { RealtimePublisher } from '@sreai/queue';
import {
  IncidentStatus,
  RealtimeEvent,
  ServiceMetadataSchema,
  TenantSettings,
  errorMeta,
  parseTenantSettings,
} from '@sreai/shared';
import { DataSource } from 'typeorm';
import { ActionContext } from '../handlers/action-handler';
import { MessageContext } from '../notify/slack-messages';

export interface SlackThread {
  channel: string;
  ts: string;
}

// Loading + small persistence helpers shared by the orchestrator, executor
// and escalation paths. Every query is tenant-scoped.
@Injectable()
export class IncidentContextService {
  private readonly logger = new Logger(IncidentContextService.name);

  constructor(
    @InjectDataSource() readonly dataSource: DataSource,
    private readonly realtime: RealtimePublisher,
  ) {}

  loadIncident(tenantId: string, incidentId: string): Promise<Incident | null> {
    return this.dataSource.getRepository(Incident).findOne({
      where: { tenantId, id: incidentId },
      relations: { service: true },
    });
  }

  loadDiagnosis(tenantId: string, diagnosisId: string): Promise<Diagnosis | null> {
    return this.dataSource
      .getRepository(Diagnosis)
      .findOne({ where: { tenantId, id: diagnosisId } });
  }

  latestDiagnosis(tenantId: string, incidentId: string): Promise<Diagnosis | null> {
    return this.dataSource.getRepository(Diagnosis).findOne({
      where: { tenantId, incidentId },
      order: { createdAt: 'DESC' },
    });
  }

  loadAction(tenantId: string, actionId: string): Promise<Action | null> {
    return this.dataSource.getRepository(Action).findOne({ where: { tenantId, id: actionId } });
  }

  async settings(tenantId: string): Promise<TenantSettings> {
    const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } });
    return parseTenantSettings(tenant?.settings);
  }

  actionContext(incident: Incident, diagnosis: Diagnosis | null): ActionContext {
    const metadata = ServiceMetadataSchema.safeParse(incident.service?.metadata ?? {});
    return {
      tenantId: incident.tenantId,
      incident,
      service: incident.service,
      metadata: metadata.success ? metadata.data : {},
      diagnosis,
      recommendation: diagnosis?.recommendedAction ?? '',
    };
  }

  messageContext(incident: Incident, dashboardUrl: string | undefined): MessageContext {
    return { incident, serviceName: incident.service?.name ?? 'unknown-service', dashboardUrl };
  }

  slackThread(incident: Incident): SlackThread | null {
    const slack = incident.enrichment?.slack as Partial<SlackThread> | undefined;
    return slack?.channel && slack.ts ? { channel: slack.channel, ts: slack.ts } : null;
  }

  // jsonb merge, so concurrent writers of other enrichment keys survive.
  async mergeEnrichment(incident: Incident, patch: Record<string, unknown>): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(Incident)
      .set({ enrichment: () => `enrichment || :patch::jsonb` })
      .setParameter('patch', JSON.stringify(patch))
      .where('tenant_id = :tenantId AND id = :id', { tenantId: incident.tenantId, id: incident.id })
      .execute();
  }

  // Appends to an action's own audit trail (e.g. where its Slack message
  // lives, so it can be updated when a decision is made).
  async appendActionTrail(action: Action, entry: Record<string, unknown>): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(Action)
      .set({ auditTrail: () => `audit_trail || :entry::jsonb` })
      .setParameter('entry', JSON.stringify([{ at: new Date().toISOString(), ...entry }]))
      .where('tenant_id = :tenantId AND id = :id', { tenantId: action.tenantId, id: action.id })
      .execute();
  }

  slackMessageOf(action: Action): SlackThread | null {
    const entry = [...(action.auditTrail ?? [])]
      .reverse()
      .find(
        (e) =>
          e.event === 'slack.posted' && typeof e.channel === 'string' && typeof e.ts === 'string',
      );
    return entry ? { channel: String(entry.channel), ts: String(entry.ts) } : null;
  }

  async publish(
    event: Omit<RealtimeEvent, 'at' | 'payload'> & Partial<RealtimeEvent>,
  ): Promise<void> {
    try {
      await this.realtime.publish(event);
    } catch (err) {
      this.logger.warn('Realtime publish failed', {
        tenantId: event.tenantId,
        incidentId: event.incidentId,
        ...errorMeta(err),
      });
    }
  }

  // Synthetic alerts from the integrations "Test" button: diagnosed and
  // reported, but never allowed to page anyone or touch infrastructure.
  isTestIncident(incident: Incident): boolean {
    return incident.labels?.sreai_test === 'true';
  }

  isClosed(incident: Incident): boolean {
    return incident.status === IncidentStatus.RESOLVED || incident.parentIncidentId !== null;
  }
}
