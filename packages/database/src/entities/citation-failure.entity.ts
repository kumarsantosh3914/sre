import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Diagnosis } from './diagnosis.entity';
import { TenantScopedEntity } from './tenant-scoped.entity';

// Every citation validation failure is logged here for monitoring — see
// CLAUDE.md's Citation Enforcement section.
@Entity('citation_failures')
@Index(['tenantId', 'diagnosisId'])
export class CitationFailure extends TenantScopedEntity {
  @Column({ name: 'diagnosis_id', type: 'uuid' })
  diagnosisId: string;

  @ManyToOne(() => Diagnosis)
  @JoinColumn({ name: 'diagnosis_id' })
  diagnosis: Diagnosis;

  @Column({ type: 'text' })
  claim: string;

  @Column()
  source: string;

  @Column({ type: 'text' })
  reference: string;

  @Column({ type: 'text', name: 'failure_reason' })
  failureReason: string;
}
