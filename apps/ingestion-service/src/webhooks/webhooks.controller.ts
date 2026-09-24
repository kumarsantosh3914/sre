import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AlertSource, errorMeta } from '@sreai/shared';
import { Request } from 'express';
import { ApiKeyPrincipal } from '../auth/api-key-auth.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { Principal } from '../auth/principal.decorator';
import { AlertIngestService } from './alert-ingest.service';
import { GrafanaWebhookDto } from './dto/grafana-webhook.dto';
import { IngestResultDto } from './dto/ingest-result.dto';
import { PrometheusWebhookDto } from './dto/prometheus-webhook.dto';
import { SentryWebhookDto } from './dto/sentry-webhook.dto';
import { normalizeCloudWatch } from './normalizers/cloudwatch.normalizer';
import { normalizeGeneric } from './normalizers/generic.normalizer';
import { UnsupportedPayloadError, normalizeGrafana } from './normalizers/grafana.normalizer';
import { normalizePrometheus } from './normalizers/prometheus.normalizer';
import { RawAlert } from './normalizers/raw-alert';
import { normalizeSentry } from './normalizers/sentry.normalizer';
import { verifySentrySignature } from './sentry-signature';
import { SnsMessageSchema, SnsSignatureVerifier, isTrustedSnsUrl } from './sns/sns-message';
import { WebhookConfigService } from './webhook-config.service';

const EMPTY_RESULT: IngestResultDto = { alertIds: [], accepted: 0, duplicates: 0, stormGrouped: 0 };

function normalizeOr400(fn: () => RawAlert[]): RawAlert[] {
  try {
    return fn();
  } catch (err) {
    if (err instanceof UnsupportedPayloadError) throw new BadRequestException(err.message);
    throw err;
  }
}

// Every receiver: authenticate (ApiKeyGuard), validate + normalise the
// payload, enqueue, return 200. Nothing slow happens on this path.
// Each route accepts the API key either as the trailing path segment or in
// an X-API-Key / Bearer header.
@Controller('webhooks')
@UseGuards(ApiKeyGuard)
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly ingest: AlertIngestService,
    private readonly config: WebhookConfigService,
    private readonly sns: SnsSignatureVerifier,
  ) {}

  @Post(['prometheus', 'prometheus/:apiKey'])
  @HttpCode(HttpStatus.OK)
  prometheus(
    @Principal() principal: ApiKeyPrincipal,
    @Body() body: PrometheusWebhookDto,
  ): Promise<IngestResultDto> {
    const alerts = normalizeOr400(() => normalizePrometheus(body));
    return this.ingest.ingest(principal.tenantId, AlertSource.PROMETHEUS, alerts);
  }

  @Post(['grafana', 'grafana/:apiKey'])
  @HttpCode(HttpStatus.OK)
  grafana(
    @Principal() principal: ApiKeyPrincipal,
    @Body() body: GrafanaWebhookDto,
  ): Promise<IngestResultDto> {
    const alerts = normalizeOr400(() => normalizeGrafana(body));
    return this.ingest.ingest(principal.tenantId, AlertSource.GRAFANA, alerts);
  }

  @Post(['sentry', 'sentry/:apiKey'])
  @HttpCode(HttpStatus.OK)
  async sentry(
    @Principal() principal: ApiKeyPrincipal,
    @Body() body: SentryWebhookDto,
    @Req() req: RawBodyRequest<Request>,
    @Headers('sentry-hook-resource') resource: string | undefined,
    @Headers('sentry-hook-signature') signature: string | undefined,
  ): Promise<IngestResultDto> {
    const secret = await this.config.sentryClientSecret(principal.tenantId);
    if (secret && !verifySentrySignature(req.rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid Sentry signature');
    }
    const alerts = normalizeOr400(() => normalizeSentry(resource, body));
    return this.ingest.ingest(principal.tenantId, AlertSource.SENTRY, alerts);
  }

  // CloudWatch alarm → SNS topic → HTTPS subscription to this endpoint.
  // SNS posts text/plain JSON and must have its subscription confirmed.
  @Post(['cloudwatch', 'cloudwatch/:apiKey'])
  @HttpCode(HttpStatus.OK)
  async cloudwatch(
    @Principal() principal: ApiKeyPrincipal,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<IngestResultDto> {
    const parsed = SnsMessageSchema.safeParse(this.jsonBody(req));
    if (!parsed.success) throw new BadRequestException('Not an SNS message');
    const msg = parsed.data;

    if (process.env.SNS_VERIFY_SIGNATURES !== 'false' && !(await this.sns.verify(msg))) {
      throw new UnauthorizedException('Invalid SNS signature');
    }

    if (msg.Type === 'SubscriptionConfirmation') {
      this.confirmSubscription(principal.tenantId, msg.SubscribeURL ?? null, msg.TopicArn);
      return EMPTY_RESULT;
    }
    if (msg.Type !== 'Notification') return EMPTY_RESULT;

    const alerts = normalizeOr400(() => normalizeCloudWatch(msg.Message));
    return this.ingest.ingest(principal.tenantId, AlertSource.CLOUDWATCH, alerts);
  }

  @Post(['generic', 'generic/:apiKey'])
  @HttpCode(HttpStatus.OK)
  async generic(
    @Principal() principal: ApiKeyPrincipal,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<IngestResultDto> {
    const body = this.jsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected a JSON object');
    }
    const config = await this.config.genericConfig(principal.tenantId);
    const alerts = normalizeOr400(() => normalizeGeneric(body as Record<string, unknown>, config));
    return this.ingest.ingest(principal.tenantId, AlertSource.GENERIC, alerts);
  }

  private jsonBody(req: RawBodyRequest<Request>): unknown {
    const body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        throw new BadRequestException('Body is not valid JSON');
      }
    }
    return body;
  }

  // Confirmed in the background: it's a single GET to AWS, but the webhook
  // response shouldn't wait on it.
  private confirmSubscription(
    tenantId: string,
    subscribeUrl: string | null,
    topicArn: string,
  ): void {
    if (!isTrustedSnsUrl(subscribeUrl)) {
      this.logger.warn('Ignoring SNS confirmation with untrusted SubscribeURL', {
        tenantId,
        topicArn,
      });
      return;
    }
    fetch(subscribeUrl as string, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
      .then((res) => {
        this.logger.log('SNS subscription confirmation sent', {
          tenantId,
          topicArn,
          status: res.status,
        });
      })
      .catch((err: unknown) =>
        this.logger.error('SNS subscription confirmation failed', {
          tenantId,
          topicArn,
          ...errorMeta(err),
        }),
      );
  }
}
