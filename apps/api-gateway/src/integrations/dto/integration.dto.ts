import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { IntegrationType } from '@sreai/shared';

export class CreateIntegrationDto {
  @IsEnum(IntegrationType)
  type: IntegrationType;

  // Both validated with the per-type zod schema (IntegrationSchemas).
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;
}

export class UpdateIntegrationDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  // Merged over the stored credentials: send only what changes.
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
