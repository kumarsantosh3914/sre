import { randomUUID } from 'crypto';
import { AlertSource, AlertStatus, IncidentSeverity } from '../types';
import { ActionCommandSchema, IncidentQueueMessageSchema } from './queue-messages.schema';

describe('queue message schemas', () => {
  const tenantId = randomUUID();

  it('accepts a well-formed alert message', () => {
    const parsed = IncidentQueueMessageSchema.safeParse({
      kind: 'alert',
      traceId: 'trace-1',
      alert: {
        alertId: randomUUID(),
        tenantId,
        source: AlertSource.PROMETHEUS,
        status: AlertStatus.FIRING,
        serviceName: 'auth-service',
        severity: IncidentSeverity.P1,
        title: 'HighCPU',
        description: null,
        labels: { alertname: 'HighCPU' },
        firedAt: '2026-09-15T03:14:00Z',
        resolvedAt: null,
        fingerprint: 'a'.repeat(64),
        stormKey: null,
        isStormSummary: false,
        rawPayload: {},
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown command kind', () => {
    const parsed = ActionCommandSchema.safeParse({
      kind: 'drop_database',
      traceId: 't',
      tenantId,
      incidentId: randomUUID(),
    });
    expect(parsed.success).toBe(false);
  });

  it('only allows allowlisted manual action types', () => {
    const base = {
      kind: 'manual_action',
      traceId: 't',
      tenantId,
      incidentId: randomUUID(),
      userId: randomUUID(),
      note: null,
    };
    expect(ActionCommandSchema.safeParse({ ...base, actionType: 'restart_service' }).success).toBe(
      true,
    );
    expect(ActionCommandSchema.safeParse({ ...base, actionType: 'rm_rf' }).success).toBe(false);
  });
});
