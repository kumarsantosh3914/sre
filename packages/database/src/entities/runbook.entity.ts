import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

@Entity('runbooks')
@Index(['tenantId', 'signature'], { unique: true })
export class Runbook extends TenantScopedEntity {
  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @Column({ length: 64 })
  signature: string;

  @Column({ length: 500 })
  title: string;

  @Column({ type: 'text' })
  markdown: string;

  @Column({ name: 'incident_ids', type: 'uuid', array: true, default: () => "'{}'" })
  incidentIds: string[];

  @Column({ type: 'int', default: 1 })
  version: number;
}
