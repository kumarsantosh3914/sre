import { IsObject } from 'class-validator';

export class UpdateSettingsDto {
  // Partial TenantSettings, validated with zod after merging.
  @IsObject()
  settings: Record<string, unknown>;
}
