import { Inject, Injectable } from '@nestjs/common';
import { ECSClient } from '@aws-sdk/client-ecs';
import { IntegrationReader } from '@sreai/database';
import { IntegrationType } from '@sreai/shared';
import { INTEGRATION_READER } from '../common/tokens';

export type EcsClientLike = Pick<ECSClient, 'send'>;
export const ECS_CLIENT_BUILDER = Symbol('ECS_CLIENT_BUILDER');
export type EcsClientBuilder = (config: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}) => EcsClientLike;

export const defaultEcsClientBuilder: EcsClientBuilder = (config) =>
  new ECSClient({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

export class MissingIntegrationError extends Error {}

// ECS clients built per call from the tenant's own AWS integration — SRE.ai
// never acts on customer infrastructure with platform credentials.
@Injectable()
export class EcsClientFactory {
  constructor(
    @Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader,
    @Inject(ECS_CLIENT_BUILDER) private readonly build: EcsClientBuilder,
  ) {}

  async forTenant(tenantId: string, regionOverride?: string): Promise<EcsClientLike> {
    const aws = await this.integrations.get(tenantId, IntegrationType.AWS);
    if (!aws) throw new MissingIntegrationError('No AWS integration configured');
    return this.build({
      region: regionOverride ?? aws.config.region,
      accessKeyId: aws.credentials.accessKeyId,
      secretAccessKey: aws.credentials.secretAccessKey,
    });
  }
}
