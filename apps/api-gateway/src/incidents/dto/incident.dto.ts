import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ActionType, IncidentSeverity, IncidentStatus } from '@sreai/shared';
import { PaginationQueryDto } from '../../common/pagination';

const csv = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : value;

export class ListIncidentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsEnum(IncidentStatus, { each: true })
  status?: IncidentStatus[];

  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsEnum(IncidentSeverity, { each: true })
  severity?: IncidentSeverity[];

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  // Incidents folded into an alert storm are hidden by default.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeGrouped?: boolean;
}

export class ResolveIncidentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export const MANUAL_ACTION_TYPES = [
  ActionType.RESTART_SERVICE,
  ActionType.SCALE_SERVICE,
  ActionType.FLUSH_CACHE,
  ActionType.REDEPLOY,
  ActionType.ESCALATE,
] as const;

export class ManualActionDto {
  @IsIn(MANUAL_ACTION_TYPES)
  actionType: (typeof MANUAL_ACTION_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class AuditExportQueryDto {
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}
