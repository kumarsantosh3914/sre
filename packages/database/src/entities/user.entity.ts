import { UserRole } from '@sreai/shared';
import { Column, Entity } from 'typeorm';
import { TenantScopedEntity } from './tenant-scoped.entity';

// Email is globally unique, not per-tenant: a user belongs to exactly one
// tenant, and login resolves the account (and its tenant) by email before
// tenantId is known — the one lookup in this codebase allowed to not be
// tenant-scoped, since tenantId is what it's resolving.
@Entity('users')
export class User extends TenantScopedEntity {
  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role_enum', default: UserRole.MEMBER })
  role: UserRole;

  // SHA-256 hex digest of the current refresh token (NOT bcrypt — bcrypt
  // truncates at 72 bytes, which silently breaks rotation invalidation for
  // tokens this long; see auth.service.ts's hashRefreshToken for why), so a
  // stolen JWT can't be replayed after logout/rotation without also
  // compromising the DB.
  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true })
  refreshTokenHash: string | null;
}
