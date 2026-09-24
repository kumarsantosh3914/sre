import { IncidentSeverity, ServiceMetadata } from '@sreai/shared';

// Evidence source types — the same enum DiagnosisOutput.evidence[].source
// uses, so a citation's source names exactly one context section.
export type ContextSource = 'logs' | 'metrics' | 'deploy' | 'dependency' | 'similar_incident';

export const CONTEXT_SOURCES: readonly ContextSource[] = [
  'logs',
  'metrics',
  'deploy',
  'dependency',
  'similar_incident',
];

export type SectionStatus = 'ok' | 'empty' | 'not_configured' | 'error' | 'timeout';

export interface ContextSection {
  source: ContextSource;
  status: SectionStatus;
  // Each line is one citable unit, already sanitised for the prompt.
  lines: string[];
  // Why a section is empty/unavailable — shown to the LLM so it knows the
  // absence of evidence is not evidence of absence.
  note?: string;
}

export interface DeployInfo {
  sha: string;
  author: string;
  message: string;
  committedAt: string;
  minutesBeforeAlert: number;
  url: string | null;
  highSignalFiles: string[];
}

export interface SimilarIncidentSummary {
  incidentId: string;
  title: string;
  similarity: number;
  mttrSeconds: number | null;
  rootCause: string | null;
  actionTaken: string | null;
}

export interface PatternMatch {
  actionType: string;
  occurrences: number;
  successes: number;
}

export interface IncidentSnapshot {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  serviceName: string;
  labels: Record<string, string>;
  detectedAt: Date;
  fingerprint: string | null;
}

export interface CollectorInput {
  incident: IncidentSnapshot;
  serviceId: string | null;
  metadata: ServiceMetadata;
}

export interface DiagnosisContext {
  incident: IncidentSnapshot;
  sections: Record<ContextSource, ContextSection>;
  recentDeploy: DeployInfo | null;
  similarIncidents: SimilarIncidentSummary[];
  pattern: PatternMatch | null;
}

export interface Collector<TExtra = undefined> {
  readonly source: ContextSource;
  collect(input: CollectorInput): Promise<CollectorResult<TExtra>>;
}

export interface CollectorResult<TExtra = undefined> {
  section: ContextSection;
  extra?: TExtra;
}

export function emptySection(
  source: ContextSource,
  status: SectionStatus,
  note: string,
): ContextSection {
  return { source, status, lines: [], note };
}
