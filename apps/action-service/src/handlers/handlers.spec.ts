import { DescribeServicesCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { Diagnosis, Incident } from '@sreai/database';
import { ActionContext } from './action-handler';
import { EcsClientFactory, EcsClientLike } from './ecs-client.factory';
import { RestartServiceHandler } from './restart-service.handler';
import { ScaleServiceHandler } from './scale-service.handler';

function fakeEcs(desiredCount: number, status = 'ACTIVE') {
  const state = { desiredCount, forced: 0 };
  const client: EcsClientLike = {
    send: jest.fn(async (command: unknown) => {
      if (command instanceof DescribeServicesCommand) {
        return { services: [{ status, desiredCount: state.desiredCount, deployments: [] }] };
      }
      if (command instanceof UpdateServiceCommand) {
        if (command.input.desiredCount !== undefined)
          state.desiredCount = command.input.desiredCount;
        if (command.input.forceNewDeployment) state.forced += 1;
        return {
          service: {
            desiredCount: state.desiredCount,
            deployments: [{ id: 'd1', status: 'PRIMARY' }],
          },
        };
      }
      throw new Error('unexpected command');
    }) as unknown as EcsClientLike['send'],
  };
  const factory = { forTenant: jest.fn().mockResolvedValue(client) } as unknown as EcsClientFactory;
  return { state, factory };
}

function ctx(metadata: ActionContext['metadata'], recentDeploy: unknown = null): ActionContext {
  return {
    tenantId: 't1',
    incident: { id: 'i1' } as Incident,
    service: null,
    metadata,
    diagnosis: { contextUsed: { recentDeploy } } as unknown as Diagnosis,
    recommendation: '',
  };
}

const ecs = { cluster: 'prod', service: 'auth', maxTasks: 3 };

describe('ScaleServiceHandler', () => {
  it('requires a scaling ceiling to plan at all', () => {
    const { factory } = fakeEcs(1);
    const handler = new ScaleServiceHandler(factory);
    expect(handler.plan(ctx({ ecs: { cluster: 'prod', service: 'auth' } }))).toBeNull();
    expect(handler.plan(ctx({ ecs }))?.description).toContain('out by 1 task (max 3)');
  });

  it('adds exactly one task, refuses beyond max, and rolls back to the previous count', async () => {
    const { state, factory } = fakeEcs(2);
    const handler = new ScaleServiceHandler(factory);
    const c = ctx({ ecs });
    const planned = handler.plan(c)!;

    expect(await handler.validate(c, planned)).toEqual({ ok: true });
    const result = await handler.execute(c, planned);
    expect(result).toEqual({ previousDesiredCount: 2, newDesiredCount: 3 });
    expect(state.desiredCount).toBe(3);

    expect(await handler.validate(c, planned)).toEqual({
      ok: false,
      reason: 'already at the configured maximum of 3 tasks',
    });

    await handler.rollback(c, planned, result);
    expect(state.desiredCount).toBe(2);
  });
});

describe('RestartServiceHandler', () => {
  it('refuses to restart right after a deploy', async () => {
    const { factory } = fakeEcs(2);
    const handler = new RestartServiceHandler(factory);
    const c = ctx({ ecs }, { sha: 'abc' });
    expect((await handler.validate(c, handler.plan(c)!)).ok).toBe(false);
  });

  it('refuses when the ECS service is not ACTIVE, forces a new deployment otherwise', async () => {
    const inactive = fakeEcs(2, 'DRAINING');
    const c = ctx({ ecs });
    const h1 = new RestartServiceHandler(inactive.factory);
    expect(await h1.validate(c, h1.plan(c)!)).toEqual({
      ok: false,
      reason: 'ECS service is DRAINING',
    });

    const active = fakeEcs(2);
    const h2 = new RestartServiceHandler(active.factory);
    expect(await h2.validate(c, h2.plan(c)!)).toEqual({ ok: true });
    await h2.execute(c, h2.plan(c)!);
    expect(active.state.forced).toBe(1);
    expect(h2.reversible).toBe(false);
  });
});
