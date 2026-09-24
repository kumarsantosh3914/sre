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

  // Final, adjusted confidence (after citation enforcement and scoring) —
  // the only score the action layer ever routes on.
  @Column({ type: 'float' })
  confidence: number;

  // What the model itself claimed, kept for calibration analysis.
  @Column({ name: 'llm_confidence', type: 'float', nullable: true })
  llmConfidence: number | null;

  @Column({ type: 'jsonb' })
  evidence: DiagnosisOutput['evidence'];

  @Column({ type: 'text', name: 'recommended_action' })
  recommendedAction: string;

  @Column({ type: 'enum', enum: ActionTier, enumName: 'action_tier_enum', name: 'action_tier' })
  actionTier: ActionTier;

  @Column({ type: 'text' })
  reasoning: string;

  @Column({ name: 'citation_failure_rate', type: 'float', default: 0 })
  citationFailureRate: number;

  @Column({ name: 'citations_passed', default: true })
  citationsPassed: boolean;

  // The exact rendered context the LLM saw (what citations were checked
  // against) plus per-collector status.
  @Column({ name: 'context_used', type: 'jsonb', default: () => "'{}'" })
  contextUsed: Record<string, unknown>;

  @Column({ name: 'similar_incident_ids', type: 'uuid', array: true, default: () => "'{}'" })
  similarIncidentIds: string[];

  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  @Column({ name: 'prompt_version', type: 'varchar', length: 32, nullable: true })
  promptVersion: string | null;

  @Column({ name: 'token_usage', type: 'jsonb', nullable: true })
  tokenUsage: Record<string, number> | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;
}
