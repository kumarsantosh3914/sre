import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { AlertmanagerAlertDto } from './prometheus-webhook.dto';

export class GrafanaEvalMatchDto {
  @IsOptional()
  @IsString()
  metric?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsObject()
  tags?: Record<string, string> | null;
}

// Covers both Grafana webhook formats:
// - unified alerting (Grafana 8+): Alertmanager-style `alerts[]`
// - legacy dashboard alerts: `state` + `ruleName` + `evalMatches[]`
export class GrafanaWebhookDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AlertmanagerAlertDto)
  alerts?: AlertmanagerAlertDto[];

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  ruleName?: string;

  @IsOptional()
  @IsNumber()
  ruleId?: number;

  @IsOptional()
  @IsString()
  ruleUrl?: string;

  @IsOptional()
  @IsObject()
  tags?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GrafanaEvalMatchDto)
  evalMatches?: GrafanaEvalMatchDto[];
}
