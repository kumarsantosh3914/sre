import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@sreai/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

// Mutating tenant configuration (integrations, API keys, thresholds,
// services) is owner/admin only; members can view and act on incidents.
export const AdminOnly = (): MethodDecorator & ClassDecorator =>
  Roles(UserRole.OWNER, UserRole.ADMIN);
