import { Inject, Injectable } from '@nestjs/common';
import { IntegrationReader } from '@sreai/database';
import { ActionType, IntegrationType } from '@sreai/shared';
import { INTEGRATION_READER } from '../common/tokens';
import {
  ActionContext,
  ActionHandler,
  PlannedAction,
  ValidationResult,
  recentDeployOf,
} from './action-handler';

// Re-runs the service's GitHub Actions deploy workflow (workflow_dispatch).
// Precondition (build guide): a deploy was detected as the likely cause.
@Injectable()
export class RedeployHandler implements ActionHandler {
  readonly type = ActionType.REDEPLOY;
  readonly reversible = false;
  private readonly apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';

  constructor(@Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader) {}

  plan(ctx: ActionContext): PlannedAction | null {
    const { repo, redeploy } = ctx.metadata;
    if (!repo || !redeploy) return null;
    return {
      type: this.type,
      description: `Re-run GitHub Actions workflow ${redeploy.workflow} on ${repo}@${redeploy.ref}`,
      target: { repo, workflow: redeploy.workflow, ref: redeploy.ref },
    };
  }

  async validate(ctx: ActionContext): Promise<ValidationResult> {
    if (ctx.diagnosis && !recentDeployOf(ctx.diagnosis)) {
      return { ok: false, reason: 'no recent deploy was found in the diagnosis context' };
    }
    const github = await this.integrations.get(ctx.tenantId, IntegrationType.GITHUB);
    return github ? { ok: true } : { ok: false, reason: 'no GitHub integration configured' };
  }

  async execute(ctx: ActionContext, planned: PlannedAction): Promise<Record<string, unknown>> {
    const github = await this.integrations.get(ctx.tenantId, IntegrationType.GITHUB);
    if (!github) throw new Error('no GitHub integration configured');
    const { repo, workflow, ref } = planned.target as {
      repo: string;
      workflow: string;
      ref: string;
    };
    const res = await fetch(
      `${this.apiBase}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${github.credentials.token}`,
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
          'user-agent': 'sre-ai',
        },
        body: JSON.stringify({ ref }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status !== 204) {
      throw new Error(`GitHub workflow dispatch failed: HTTP ${res.status}`);
    }
    return { repo, workflow, ref, dispatchedAt: new Date().toISOString() };
  }
}
