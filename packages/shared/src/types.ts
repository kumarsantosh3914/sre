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
  EXPIRED = 'expired',
}

// What an action record actually did. The executable subset is the only
// set of things SRE.ai will ever do to a customer's infrastructure on its
// own — see ExecutableActionType below.
export enum ActionType {
  RESTART_SERVICE = 'restart_service',
  SCALE_SERVICE = 'scale_service',
  FLUSH_CACHE = 'flush_cache',
  REDEPLOY = 'redeploy',
  NOTIFY = 'notify',
  ESCALATE = 'escalate',
  ROLLBACK = 'rollback',
}

export const EXECUTABLE_ACTION_TYPES = [
  ActionType.RESTART_SERVICE,
  ActionType.SCALE_SERVICE,
  ActionType.FLUSH_CACHE,
  ActionType.REDEPLOY,
] as const;

export type ExecutableActionType = (typeof EXECUTABLE_ACTION_TYPES)[number];

export function isExecutableActionType(value: string): value is ExecutableActionType {
  return (EXECUTABLE_ACTION_TYPES as readonly string[]).includes(value);
}

export enum AlertSource {
  PROMETHEUS = 'prometheus',
  GRAFANA = 'grafana',
  SENTRY = 'sentry',
  CLOUDWATCH = 'cloudwatch',
  GENERIC = 'generic',
}

export enum AlertStatus {
  FIRING = 'firing',
  RESOLVED = 'resolved',
}

export enum IntegrationType {
  PROMETHEUS = 'prometheus',
  GRAFANA = 'grafana',
  SENTRY = 'sentry',
  CLOUDWATCH = 'cloudwatch',
  GENERIC = 'generic',
  LOKI = 'loki',
  AWS = 'aws',
  GITHUB = 'github',
  SLACK = 'slack',
  PAGERDUTY = 'pagerduty',
  REDIS = 'redis',
}

export enum AuditActorType {
  SYSTEM = 'system',
  USER = 'user',
  SLACK = 'slack',
}

export interface RequestContext {
  traceId: string;
  tenantId: string;
}

export enum UserRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

export interface JwtAccessPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
}
