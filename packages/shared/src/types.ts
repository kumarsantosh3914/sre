export enum IncidentStatus {
  DETECTING = 'detecting',
  DIAGNOSING = 'diagnosing',
  ACTING = 'acting',
  RESOLVED = 'resolved',
  ESCALATED = 'escalated',
}

export enum ActionTier {
  AUTO = 'auto',
  DRAFT = 'draft',
  ESCALATE = 'escalate',
}

export enum IncidentSeverity {
  P1 = 'p1',
  P2 = 'p2',
  P3 = 'p3',
}

export interface RequestContext {
  traceId: string;
  tenantId: string;
}
