import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9._-]+$/, { message: 'name may only contain a-z, 0-9, ".", "_" and "-"' })
  name: string;

  @IsOptional()
  @IsBoolean()
  alwaysEscalate?: boolean;

  @IsOptional()
  @IsBoolean()
  autoExecuteEnabled?: boolean;

  // Validated against ServiceMetadataSchema (zod) in the service.
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsBoolean()
  alwaysEscalate?: boolean;

  @IsOptional()
  @IsBoolean()
  autoExecuteEnabled?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
