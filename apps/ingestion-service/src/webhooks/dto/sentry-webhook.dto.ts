import { IsObject, IsOptional, IsString } from 'class-validator';

// Sentry integration-platform webhook. The resource type (issue,
// event_alert, metric_alert, error) arrives in the Sentry-Hook-Resource
// header; `data` differs per resource and is parsed by the normaliser.
export class SentryWebhookDto {
  @IsString()
  action: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  installation?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  actor?: Record<string, unknown>;
}
