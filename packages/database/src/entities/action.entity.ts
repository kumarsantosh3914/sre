import { ActionStatus, ActionTier, ActionType } from '@sreai/shared';
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

  @Column({ name: 'action_type', type: 'varchar', length: 30, default: ActionType.NOTIFY })
  actionType: ActionType;

  // Human-readable: "Restart ECS service prod/auth-service".
  @Column({ type: 'text', default: '' })
  description: string;

  // Handler input (target identifiers, the diagnosis that justified it).
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  // Handler output — including whatever state rollback needs to restore.
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'jsonb', name: 'audit_trail', default: () => "'[]'" })
  auditTrail: Record<string, unknown>[];

  // "system", "user:<uuid>", or "slack:<slack user id>".
  @Column({ name: 'requested_by', type: 'varchar', length: 128, nullable: true })
  requestedBy: string | null;

  @Column({ name: 'decided_by', type: 'varchar', length: 128, nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  // Pending approvals auto-escalate after this.
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  // For rollback records: the action being undone.
  @Column({ name: 'parent_action_id', type: 'uuid', nullable: true })
  parentActionId: string | null;

  @Column({ type: 'timestamptz', name: 'executed_at', nullable: true })
  executedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'rolled_back_at', nullable: true })
  rolledBackAt: Date | null;
}
