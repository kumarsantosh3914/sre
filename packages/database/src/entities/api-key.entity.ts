import { Column, Entity, Index } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

// Webhook API keys. Only the SHA-256 digest is stored; the plaintext is
// shown to the user once at creation.
@Entity('api_keys')
@Index(['tenantId'])
export class ApiKey extends TenantScopedEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ name: 'display_prefix', length: 32 })
  displayPrefix: string;

  @Column({ name: 'key_hash', length: 64, unique: true })
  keyHash: string;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  // Set on rotation: the old key keeps working until this moment.
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
