import { z } from 'zod';
import { ActionType } from '../types';
import { NormalizedAlertSchema } from './alert.schema';

const traceId = z.string().min(1).max(64);
const uuid = z.string().uuid();

// ---- sreai-incidents-p1 / sreai-incidents-p2 (→ diagnosis-service) ----

export const AlertMessageSchema = z.object({
  kind: z.literal('alert'),
  traceId,
  alert: NormalizedAlertSchema,
});

// A resolution that did not come from the monitoring tool itself (a human
// resolving from the dashboard). Routed through the same queue so the
// diagnosis-service stays the single writer of incident lifecycle state.
export const ManualResolveMessageSchema = z.object({
  kind: z.literal('manual_resolve'),
  traceId,
  tenantId: uuid,
  incidentId: uuid,
  userId: uuid,
  note: z.string().max(2000).nullable(),
});

export const IncidentQueueMessageSchema = z.discriminatedUnion('kind', [
  AlertMessageSchema,
  ManualResolveMessageSchema,
]);

export type AlertMessage = z.infer<typeof AlertMessageSchema>;
export type ManualResolveMessage = z.infer<typeof ManualResolveMessageSchema>;
export type IncidentQueueMessage = z.infer<typeof IncidentQueueMessageSchema>;

// ---- sreai-actions (→ action-service) ----

const base = { traceId, tenantId: uuid, incidentId: uuid };

export const IncidentOpenedCommandSchema = z.object({
  kind: z.literal('incident_opened'),
  ...base,
});

export const DiagnosisCompletedCommandSchema = z.object({
  kind: z.literal('diagnosis_completed'),
  ...base,
  diagnosisId: uuid,
});

// Diagnosis gave up (e.g. LLM unavailable after all retries). Must still
// reach a human — the action-service escalates with the raw alert.
export const DiagnosisFailedCommandSchema = z.object({
  kind: z.literal('diagnosis_failed'),
  ...base,
  reason: z.string().max(2000),
});

export const IncidentResolvedCommandSchema = z.object({
  kind: z.literal('incident_resolved'),
  ...base,
});

export const ActionDecisionCommandSchema = z.object({
  kind: z.literal('action_decision'),
  ...base,
  actionId: uuid,
  decision: z.enum(['approve', 'reject']),
  actorType: z.enum(['user', 'slack']),
  actorId: z.string().min(1).max(128),
  reason: z.string().max(2000).nullable(),
});

export const RollbackRequestedCommandSchema = z.object({
  kind: z.literal('rollback_requested'),
  ...base,
  actionId: uuid,
  actorType: z.enum(['user', 'slack']),
  actorId: z.string().min(1).max(128),
});

export const ManualActionCommandSchema = z.object({
  kind: z.literal('manual_action'),
  ...base,
  actionType: z.enum([
    ActionType.RESTART_SERVICE,
    ActionType.SCALE_SERVICE,
    ActionType.FLUSH_CACHE,
    ActionType.REDEPLOY,
    ActionType.ESCALATE,
  ]),
  userId: uuid,
  note: z.string().max(2000).nullable(),
});

export const ActionCommandSchema = z.discriminatedUnion('kind', [
  IncidentOpenedCommandSchema,
  DiagnosisCompletedCommandSchema,
  DiagnosisFailedCommandSchema,
  IncidentResolvedCommandSchema,
  ActionDecisionCommandSchema,
  RollbackRequestedCommandSchema,
  ManualActionCommandSchema,
]);

export type ActionCommand = z.infer<typeof ActionCommandSchema>;
export type DiagnosisCompletedCommand = z.infer<typeof DiagnosisCompletedCommandSchema>;
export type DiagnosisFailedCommand = z.infer<typeof DiagnosisFailedCommandSchema>;
export type ActionDecisionCommand = z.infer<typeof ActionDecisionCommandSchema>;
export type RollbackRequestedCommand = z.infer<typeof RollbackRequestedCommandSchema>;
export type ManualActionCommand = z.infer<typeof ManualActionCommandSchema>;
