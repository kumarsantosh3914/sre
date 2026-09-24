import { DescribeServicesCommand, Service } from '@aws-sdk/client-ecs';
import { ServiceMetadata } from '@sreai/shared';
import { EcsClientLike } from './ecs-client.factory';

export interface EcsTarget extends Record<string, unknown> {
  cluster: string;
  service: string;
  region?: string;
  maxTasks?: number;
}

export function ecsTargetOf(metadata: ServiceMetadata): EcsTarget | null {
  if (!metadata.ecs) return null;
  return {
    cluster: metadata.ecs.cluster,
    service: metadata.ecs.service,
    ...(metadata.ecs.region ? { region: metadata.ecs.region } : {}),
    ...(metadata.ecs.maxTasks ? { maxTasks: metadata.ecs.maxTasks } : {}),
  };
}

export async function describeEcsService(
  client: EcsClientLike,
  target: EcsTarget,
): Promise<Service | null> {
  const res = await client.send(
    new DescribeServicesCommand({ cluster: target.cluster, services: [target.service] }),
  );
  return res.services?.[0] ?? null;
}
