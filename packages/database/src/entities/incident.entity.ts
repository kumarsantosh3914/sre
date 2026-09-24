import { AlertSource, IncidentSeverity, IncidentStatus } from '@sreai/shared';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { MonitoredService } from './monitored-service.entity';
import { TenantScopedEntity } from './tenant-scoped.entity';

@Entity('incidents')
@Index(['tenantId', 'status'])
export class Incident extends TenantScopedEntity {
  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => MonitoredService, { nullable: true })
  @JoinColumn({ name: 'service_id' })
  service: MonitoredService | null;

  @Column({ type: 'enum', enum: IncidentSeverity, enumName: 'incident_severity_enum' })
  severity: IncidentSeverity;

  @Column({
    type: 'enum',
    enum: IncidentStatus,
    enumName: 'incident_status_enum',
    default: IncidentStatus.DETECTING,
  })
  status: IncidentStatus;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'alert_source', type: 'varchar', length: 30, default: AlertSource.GENERIC })
  alertSource: AlertSource;

  // SHA-256(tenantId | service | normalised title) — see NormalizedAlert.
  @Column({ type: 'varchar', length: 64, nullable: true })
  fingerprint: string | null;

  // Idempotency key for creation (the ingestion alertId, or a storm key).
  @Column({ name: 'ingest_key', type: 'varchar', length: 128, nullable: true })
  ingestKey: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  labels: Record<string, string>;

  // Service metadata attached at intake (owner, repo, runbook URL).
  @Column({ type: 'jsonb', default: () => "'{}'" })
  enrichment: Record<string, unknown>;

  @Column({ name: 'alert_count', type: 'int', default: 1 })
  alertCount: number;

  @Column({ name: 'last_alert_at', type: 'timestamptz', nullable: true })
  lastAlertAt: Date | null;

  // Set when this incident was folded into an alert-storm incident.
  @Column({ name: 'parent_incident_id', type: 'uuid', nullable: true })
  parentIncidentId: string | null;

  // Raw webhook payload that created this incident (Prometheus/Datadog/etc.)
  @Column({ type: 'jsonb', name: 'source_alert' })
  sourceAlert: Record<string, unknown>;

  @Column({ type: 'timestamptz', name: 'detected_at' })
  detectedAt: Date;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'int', name: 'mttr_seconds', nullable: true })
  mttrSeconds: number | null;

  // User who resolved it manually; null when the alert itself cleared.
  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  // pgvector `embedding vector(1536)` is deliberately not mapped: TypeORM
  // has no vector type, so it is read/written only through the raw,
  // tenant-scoped SQL in IncidentEmbeddingRepository.
}
