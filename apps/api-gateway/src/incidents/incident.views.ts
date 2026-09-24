import { Action, AuditLog, CitationFailure, Diagnosis, Incident } from '@sreai/database';

// API views: what the dashboard needs, never internal columns like the
// raw prompt or ingest keys unless explicitly part of the detail view.

export function incidentSummary(incident: Incident, latest?: Diagnosis) {
  return {
    id: incident.id,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    alertSource: incident.alertSource,
    service: incident.service ? { id: incident.service.id, name: incident.service.name } : null,
    alertCount: incident.alertCount,
    parentIncidentId: incident.parentIncidentId,
    detectedAt: incident.detectedAt,
    resolvedAt: incident.resolvedAt,
    mttrSeconds: incident.mttrSeconds,
    diagnosis: latest
      ? {
          confidence: latest.confidence,
          actionTier: latest.actionTier,
          citationsPassed: latest.citationsPassed,
        }
      : null,
  };
}

export function diagnosisView(d: Diagnosis, failures: CitationFailure[] = []) {
  const context = d.contextUsed as {
    collectors?: unknown;
    scoring?: unknown;
    citationChecks?: unknown;
    recentDeploy?: unknown;
  };
  return {
    id: d.id,
    hypothesis: d.hypothesis,
    confidence: d.confidence,
    llmConfidence: d.llmConfidence,
    evidence: d.evidence,
    recommendedAction: d.recommendedAction,
    actionTier: d.actionTier,
    reasoning: d.reasoning,
    citationsPassed: d.citationsPassed,
    citationFailureRate: d.citationFailureRate,
    citationFailures: failures.map((f) => ({
      claim: f.claim,
      source: f.source,
      reference: f.reference,
      reason: f.failureReason,
    })),
    citationChecks: context.citationChecks ?? [],
    scoring: context.scoring ?? null,
    collectors: context.collectors ?? [],
    recentDeploy: context.recentDeploy ?? null,
    similarIncidentIds: d.similarIncidentIds,
    model: d.model,
    promptVersion: d.promptVersion,
    tokenUsage: d.tokenUsage,
    latencyMs: d.latencyMs,
    createdAt: d.createdAt,
  };
}

export function actionView(a: Action) {
  return {
    id: a.id,
    tier: a.tier,
    status: a.status,
    actionType: a.actionType,
    description: a.description,
    result: a.result,
    error: a.error,
    requestedBy: a.requestedBy,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt,
    expiresAt: a.expiresAt,
    parentActionId: a.parentActionId,
    executedAt: a.executedAt,
    rolledBackAt: a.rolledBackAt,
    createdAt: a.createdAt,
  };
}

export function auditView(e: AuditLog) {
  return {
    id: e.id,
    event: e.event,
    actorType: e.actorType,
    actorId: e.actorId,
    before: e.before,
    after: e.after,
    metadata: e.metadata,
    at: e.createdAt,
  };
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  // Quote everything; neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function auditCsv(events: AuditLog[]): string {
  const header = ['at', 'event', 'actor_type', 'actor_id', 'before', 'after', 'metadata'];
  const rows = events.map((e) =>
    [e.createdAt.toISOString(), e.event, e.actorType, e.actorId, e.before, e.after, e.metadata]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}
