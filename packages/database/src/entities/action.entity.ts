import { ActionStatus, ActionTier } from '@sreai/shared';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Incident } from './incident.entity';
import { TenantScopedEntity } from './tenant-scoped.entity';

@Entity('actions')
@Index(['tenantId', 'incidentId'])
export class Action extends TenantScopedEntity {
  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident: Incident;

  @Column({ type: 'enum', enum: ActionTier, enumName: 'action_tier_enum' })
  tier: ActionTier;

  @Column({
    type: 'enum',
    enum: ActionStatus,
    enumName: 'action_status_enum',
    default: ActionStatus.PENDING,
  })
  status: ActionStatus;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'jsonb', name: 'audit_trail', default: () => "'[]'" })
  auditTrail: Record<string, unknown>[];

  @Column({ type: 'timestamptz', name: 'executed_at', nullable: true })
  executedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'rolled_back_at', nullable: true })
  rolledBackAt: Date | null;
}
