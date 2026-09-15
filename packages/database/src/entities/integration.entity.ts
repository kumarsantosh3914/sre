import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

// Credentials are encrypted at rest with ENCRYPTION_KEY before being
// written here — the app layer must never persist plaintext.
@Entity('integrations')
@Index(['tenantId', 'type'], { unique: true })
export class Integration extends TenantScopedEntity {
  @Column()
  type: string;

  @Column({ type: 'text', name: 'encrypted_credentials' })
  encryptedCredentials: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;
}
