import { AuditActorType } from '@sreai/shared';
import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

// Append-only (enforced by a DB trigger — see migration
// ActionLayerAndAuditLog). Every incident state change lands here.
@Entity('audit_logs')
@Index(['tenantId', 'incidentId', 'createdAt'])
export class AuditLog extends TenantScopedEntity {
  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId: string | null;

  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType: AuditActorType;

  @Column({ name: 'actor_id', type: 'varchar', length: 128, nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 64 })
  event: string;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;
}
