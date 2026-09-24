import { z } from 'zod';
import { IncidentStatus } from '../types';

// Published on REALTIME_CHANNEL by any service that changes incident state;
// the api-gateway relays each event to the owning tenant's sockets only.
export const RealtimeEventSchema = z.object({
  tenantId: z.string().uuid(),
  type: z.enum(['incident.created', 'incident.updated', 'diagnosis.completed', 'action.updated']),
  incidentId: z.string().uuid(),
  status: z.nativeEnum(IncidentStatus).optional(),
  payload: z.record(z.unknown()).default({}),
  at: z.string().datetime({ offset: true }),
});

export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
