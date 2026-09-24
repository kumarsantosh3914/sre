import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AlertmanagerAlertDto {
  @IsIn(['firing', 'resolved'])
  status: 'firing' | 'resolved';

  @IsObject()
  labels: Record<string, string>;

  @IsOptional()
  @IsObject()
  annotations?: Record<string, string>;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  generatorURL?: string;

  @IsOptional()
  @IsString()
  fingerprint?: string;
}

// Alertmanager webhook_config payload (version 4). Grafana unified
// alerting sends the same shape plus a few extra fields.
export class PrometheusWebhookDto {
  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  receiver?: string;

  @IsOptional()
  @IsString()
  groupKey?: string;

  @IsOptional()
  @IsObject()
  commonLabels?: Record<string, string>;

  @IsOptional()
  @IsObject()
  commonAnnotations?: Record<string, string>;

  @IsOptional()
  @IsString()
  externalURL?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AlertmanagerAlertDto)
  alerts: AlertmanagerAlertDto[];
}
