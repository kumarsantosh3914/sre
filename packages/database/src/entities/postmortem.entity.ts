import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

@Entity('postmortems')
@Index(['tenantId', 'incidentId'], { unique: true })
export class Postmortem extends TenantScopedEntity {
  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @Column({ type: 'text' })
  markdown: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  prevention: string[];

  // S3 object key, when object storage is configured.
  @Column({ name: 'storage_key', type: 'varchar', length: 512, nullable: true })
  storageKey: string | null;
}
