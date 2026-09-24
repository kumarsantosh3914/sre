import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

// "When alert X fires on service Z, action A resolves it N of M times."
@Entity('resolution_patterns')
@Index(['tenantId', 'signature', 'actionType'], { unique: true })
export class ResolutionPattern extends TenantScopedEntity {
  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  // Same derivation as the incident fingerprint (tenant|service|title).
  @Column({ length: 64 })
  signature: string;

  @Column({ name: 'alert_title', length: 500 })
  alertTitle: string;

  @Column({ name: 'action_type', length: 30 })
  actionType: string;

  @Column({ name: 'root_cause', type: 'text' })
  rootCause: string;

  @Column({ type: 'int', default: 0 })
  occurrences: number;

  @Column({ type: 'int', default: 0 })
  successes: number;

  @Column({ name: 'incident_ids', type: 'uuid', array: true, default: () => "'{}'" })
  incidentIds: string[];

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;
}
