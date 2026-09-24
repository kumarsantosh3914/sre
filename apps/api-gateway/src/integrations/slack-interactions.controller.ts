import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { Action, IntegrationReader } from '@sreai/database';
import { IntegrationType, getTraceContext, newTraceId, updateTraceContext } from '@sreai/shared';
import { RawResponse } from '@sreai/shared/nest';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { Public } from '../auth/decorators/public.decorator';
import { CommandBus } from '../common/command-bus.service';
import { INTEGRATION_READER } from '../common/integration-reader.provider';
import { verifySlackSignature } from './slack-signature';

const ButtonValueSchema = z.object({
  tenantId: z.string().uuid(),
  incidentId: z.string().uuid(),
  actionId: z.string().uuid(),
});

const PayloadSchema = z.object({
  type: z.string(),
  user: z.object({ id: z.string().min(1).max(64) }),
  team: z.object({ id: z.string().min(1).max(64) }).nullish(),
  actions: z.array(z.object({ action_id: z.string(), value: z.string().optional() })).default([]),
});

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const ACTION_IDS = {
  approve: 'sreai_approve',
  reject: 'sreai_reject',
  rollback: 'sreai_rollback',
} as const;

// Slack interactivity request URL. Authenticated by Slack's request
// signature (not JWT); a button can only act on the tenant/action it was
// rendered for, and only from that tenant's Slack workspace.
@Controller('integrations/slack')
export class SlackInteractionsController {
  private readonly logger = new Logger(SlackInteractionsController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly commands: CommandBus,
    @Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Public()
  @SkipThrottle()
  @RawResponse()
  @Post('interactions')
  @HttpCode(HttpStatus.OK)
  async interactions(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-slack-request-timestamp') timestamp: string | undefined,
    @Headers('x-slack-signature') signature: string | undefined,
  ): Promise<string> {
    const secret = this.config.get<string>('SLACK_SIGNING_SECRET');
    if (!secret) throw new ServiceUnavailableException('Slack interactivity is not configured');
    if (!verifySlackSignature(secret, req.rawBody, timestamp, signature)) {
      throw new UnauthorizedException('Invalid Slack signature');
    }

    const raw = (req.body as { payload?: unknown } | undefined)?.payload;
    const payload = PayloadSchema.safeParse(parseJson(raw));
    if (!payload.success || payload.data.type !== 'block_actions') return '';

    for (const action of payload.data.actions) {
      const kind = (Object.keys(ACTION_IDS) as (keyof typeof ACTION_IDS)[]).find(
        (k) => ACTION_IDS[k] === action.action_id,
      );
      if (!kind || !action.value) continue;
      const value = ButtonValueSchema.safeParse(parseJson(action.value));
      if (!value.success) continue;
      await this.dispatch(kind, value.data, payload.data.user.id, payload.data.team?.id ?? null);
    }
    // Slack needs a 200 within 3s; the message itself is updated by the
    // action-service once the decision is processed.
    return '';
  }

  private async dispatch(
    kind: keyof typeof ACTION_IDS,
    value: z.infer<typeof ButtonValueSchema>,
    slackUserId: string,
    teamId: string | null,
  ): Promise<void> {
    const { tenantId, incidentId, actionId } = value;
    updateTraceContext({ tenantId });

    const slack = await this.integrations.get(tenantId, IntegrationType.SLACK);
    if (!slack) throw new ForbiddenException('Tenant has no Slack integration');
    if (slack.config.teamId && slack.config.teamId !== teamId) {
      this.logger.warn('Slack interaction from an unexpected workspace rejected', {
        tenantId,
        teamId,
      });
      throw new ForbiddenException('Workspace mismatch');
    }
    const exists = await this.ds
      .getRepository(Action)
      .exist({ where: { tenantId, incidentId, id: actionId } });
    if (!exists) throw new ForbiddenException('Unknown action');

    const traceId = getTraceContext()?.traceId ?? newTraceId();
    if (kind === 'rollback') {
      await this.commands.action({
        kind: 'rollback_requested',
        traceId,
        tenantId,
        incidentId,
        actionId,
        actorType: 'slack',
        actorId: slackUserId,
      });
    } else {
      await this.commands.action({
        kind: 'action_decision',
        traceId,
        tenantId,
        incidentId,
        actionId,
        decision: kind,
        actorType: 'slack',
        actorId: slackUserId,
        reason: null,
      });
    }
    this.logger.log('Slack interaction dispatched', {
      tenantId,
      incidentId,
      actionId,
      kind,
      slackUserId,
    });
  }
}
