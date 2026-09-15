import { ActionTier, DiagnosisOutput } from '@sreai/shared';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Incident } from './incident.entity';
import { TenantScopedEntity } from './tenant-scoped.entity';

@Entity('diagnoses')
@Index(['tenantId', 'incidentId'])
export class Diagnosis extends TenantScopedEntity {
  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident: Incident;

  @Column({ type: 'text' })
  hypothesis: string;

  @Column({ type: 'float' })
  confidence: number;

  @Column({ type: 'jsonb' })
  evidence: DiagnosisOutput['evidence'];

  @Column({ type: 'text', name: 'recommended_action' })
  recommendedAction: string;

  @Column({ type: 'enum', enum: ActionTier, enumName: 'action_tier_enum', name: 'action_tier' })
  actionTier: ActionTier;

  @Column({ type: 'text' })
  reasoning: string;
}
