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

export enum ActionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXECUTED = 'executed',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back',
}

export interface RequestContext {
  traceId: string;
  tenantId: string;
}
