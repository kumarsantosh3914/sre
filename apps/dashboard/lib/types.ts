// Shapes returned by the api-gateway (see apps/api-gateway/src/**/*.views.ts
// and services). Kept local so the browser bundle never imports Node code.

export type IncidentStatus = 'detecting' | 'diagnosing' | 'acting' | 'resolved' | 'escalated';
export type Severity = 'p1' | 'p2' | 'p3';
export type Tier = 'auto' | 'draft' | 'escalate';
export type ActionStatus =
  'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'rolled_back' | 'expired';
export type ActionType =
  | 'restart_service'
  | 'scale_service'
  | 'flush_cache'
  | 'redeploy'
  | 'notify'
  | 'escalate'
  | 'rollback';
export type EvidenceSource = 'logs' | 'metrics' | 'deploy' | 'dependency' | 'similar_incident';
export type Role = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IncidentSummary {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  alertSource: string;
  service: { id: string; name: string } | null;
  alertCount: number;
  parentIncidentId: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  mttrSeconds: number | null;
  diagnosis: { confidence: number; actionTier: Tier; citationsPassed: boolean } | null;
}

export interface Evidence {
  claim: string;
  source: EvidenceSource;
  reference: string;
}

export interface CitationCheck {
  origin: 'evidence' | 'inline';
  claim: string;
  source: string;
  reference: string;
  valid: boolean;
  reason?: 'not_found' | 'source_mismatch' | 'too_short' | 'unknown_source';
  foundIn?: string;
}

export interface CollectorReport {
  source: EvidenceSource;
  status: 'ok' | 'empty' | 'not_configured' | 'error' | 'timeout';
  lines: number;
  durationMs: number;
  note?: string;
}

export interface Scoring {
  llmConfidence: number;
  final: number;
  adjustments: { reason: string; effect: string }[];
  capped: boolean;
}

export interface Diagnosis {
  id: string;
  hypothesis: string;
  confidence: number;
  llmConfidence: number | null;
  evidence: Evidence[];
  recommendedAction: string;
  actionTier: Tier;
  reasoning: string;
  citationsPassed: boolean;
  citationFailureRate: number;
  citationFailures: { claim: string; source: string; reference: string; reason: string }[];
  citationChecks: CitationCheck[];
  scoring: Scoring | null;
  collectors: CollectorReport[];
  recentDeploy: {
    sha: string;
    author: string;
    message: string;
    minutesBeforeAlert: number;
    url: string | null;
  } | null;
  similarIncidentIds: string[];
  model: string | null;
  promptVersion: string | null;
  tokenUsage: Record<string, number> | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface Action {
  id: string;
  tier: Tier;
  status: ActionStatus;
  actionType: ActionType;
  description: string;
  result: Record<string, unknown> | null;
  error: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  parentActionId: string | null;
  executedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
}

export interface IncidentDetail extends Omit<IncidentSummary, 'diagnosis'> {
  description: string | null;
  labels: Record<string, string>;
  enrichment: Record<string, unknown>;
  sourceAlert: Record<string, unknown>;
  resolutionNote: string | null;
  diagnosis: Diagnosis | null;
  previousDiagnoses: Diagnosis[];
  actions: Action[];
  groupedIncidents: IncidentSummary[];
  similarIncidents: IncidentSummary[];
  hasPostmortem: boolean;
}

export interface AuditEvent {
  id: string;
  event: string;
  actorType: 'system' | 'user' | 'slack';
  actorId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  at: string;
}

export interface Service {
  id: string;
  name: string;
  alwaysEscalate: boolean;
  autoExecuteEnabled: boolean;
  metadata: Record<string, unknown>;
  health: 'healthy' | 'degraded' | 'down';
  openIncidents: number;
  lastIncidentAt: string | null;
  createdAt: string;
}

export interface Integration {
  id: string;
  type: string;
  config: Record<string, unknown>;
  credentialFields: string[];
  active: boolean;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  testAlertId?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  displayPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKey {
  key: string;
  webhookUrls: Record<string, string>;
}

export interface SilenceWindow {
  days: number[];
  start: string;
  end: string;
}

export interface TenantSettings {
  timezone: string;
  autoThreshold: number | null;
  draftThreshold: number | null;
  silenceWindows: SilenceWindow[];
  digestEnabled: boolean;
  digestRecipients: string[];
}

export interface Analytics {
  windowDays: number;
  totals: {
    incidents: number;
    open: number;
    resolved: number;
    escalated: number;
    avgMttrSeconds: number | null;
  };
  mttrByService: {
    service: string;
    incidents: number;
    avgMttrSeconds: number;
    medianMttrSeconds: number;
  }[];
  mttrTrend: { day: string; avgMttrSeconds: number; resolved: number }[];
  incidentsBySeverity: { day: string; p1: number; p2: number; p3: number }[];
  autoResolve: { rate: number | null; autoResolved: number; resolved: number };
  topRecurring: {
    title: string;
    service: string | null;
    occurrences: number;
    avgMttrSeconds: number | null;
  }[];
  confidenceDistribution: { bucket: string; count: number }[];
  tierCounts: { tier: Tier; count: number }[];
  citationPassRate: number | null;
}

export interface RunbookSummary {
  id: string;
  title: string;
  service: string | null;
  incidentCount: number;
  version: number;
  updatedAt: string;
}

export interface Runbook {
  id: string;
  title: string;
  markdown: string;
  incidentIds: string[];
  version: number;
  updatedAt: string;
}

export interface Postmortem {
  incidentId: string;
  markdown: string;
  prevention: string[];
  storageKey: string | null;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface RealtimeEvent {
  tenantId: string;
  type: 'incident.created' | 'incident.updated' | 'diagnosis.completed' | 'action.updated';
  incidentId: string;
  status?: IncidentStatus;
  payload: Record<string, unknown>;
  at: string;
}
