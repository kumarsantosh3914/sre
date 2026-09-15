import { IncidentSeverity, IncidentStatus } from '@sreai/shared';
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

  // Raw webhook payload that created this incident (Prometheus/Datadog/etc.)
  @Column({ type: 'jsonb', name: 'source_alert' })
  sourceAlert: Record<string, unknown>;

  @Column({ type: 'timestamptz', name: 'detected_at' })
  detectedAt: Date;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'int', name: 'mttr_seconds', nullable: true })
  mttrSeconds: number | null;

  // pgvector `embedding vector(1536)` column is added by migration
  // 1789485653899_AddPgvectorExtension but not mapped here yet — nothing
  // reads/writes it until the diagnosis-service's similar-incident search
  // is built, at which point it should be added via the `pgvector` package.
}
