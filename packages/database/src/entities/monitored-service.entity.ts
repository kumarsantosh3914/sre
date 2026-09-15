import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

// A service the tenant monitors (e.g. "payment-service"), not a NestJS
// provider — named MonitoredService to avoid the ambiguity.
@Entity('services')
@Index(['tenantId', 'name'], { unique: true })
export class MonitoredService extends TenantScopedEntity {
  @Column()
  name: string;

  // Per-service override from CLAUDE.md: forces ESCALATE regardless of
  // confidence score, e.g. for payment-service.
  @Column({ name: 'always_escalate', default: false })
  alwaysEscalate: boolean;
}
