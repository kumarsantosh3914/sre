import { Inject, Injectable } from '@nestjs/common';
import { IntegrationReader } from '@sreai/database';
import { DEPLOY_WINDOW_MINUTES, IntegrationType } from '@sreai/shared';
import { hhmmUtc, minutesBetween } from '../../../common/time';
import { INTEGRATION_READER } from '../../../common/tokens';
import {
  Collector,
  CollectorInput,
  CollectorResult,
  DeployInfo,
  emptySection,
} from '../context.types';
import { sanitizeLine } from '../sanitize';

const MAX_COMMITS = 10;
const DETAILED_COMMITS = 3;

// Changes to these are the classic "it was the config change" root causes.
const HIGH_SIGNAL = [
  /(^|\/)\.env/i,
  /config/i,
  /settings/i,
  /\.ya?ml$/i,
  /\.toml$/i,
  /(^|\/)package(-lock)?\.json$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i,
  /requirements\.txt$/i,
  /go\.(mod|sum)$/i,
  /Dockerfile/i,
  /migrations?\//i,
  /terraform|\.tf$/i,
  /helm|k8s|kubernetes/i,
];

export function isHighSignalFile(path: string): boolean {
  return HIGH_SIGNAL.some((re) => re.test(path));
}

interface GitHubCommit {
  sha: string;
  html_url?: string;
  commit: { message: string; author?: { name?: string; date?: string } | null };
  author?: { login?: string } | null;
  files?: { filename: string; additions?: number; deletions?: number }[];
}

export interface DeployExtra {
  recentDeploy: DeployInfo | null;
}

// Commits to the service's repo in the 30 minutes before the alert — a
// deploy right before an incident is the strongest single signal there is.
@Injectable()
export class DeployCollector implements Collector<DeployExtra> {
  readonly source = 'deploy' as const;
  private readonly apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';

  constructor(@Inject(INTEGRATION_READER) private readonly integrations: IntegrationReader) {}

  async collect(input: CollectorInput): Promise<CollectorResult<DeployExtra>> {
    const { incident, metadata } = input;
    if (!metadata.repo) {
      return {
        section: emptySection('deploy', 'not_configured', 'service has no repo configured'),
      };
    }
    const github = await this.integrations.get(incident.tenantId, IntegrationType.GITHUB);
    if (!github) {
      return { section: emptySection('deploy', 'not_configured', 'no GitHub integration') };
    }

    const token = github.credentials.token;
    const since = new Date(incident.detectedAt.getTime() - DEPLOY_WINDOW_MINUTES * 60_000);
    const params = new URLSearchParams({
      since: since.toISOString(),
      until: incident.detectedAt.toISOString(),
      per_page: String(MAX_COMMITS),
    });
    if (metadata.branch) params.set('sha', metadata.branch);

    const commits = await this.get<GitHubCommit[]>(
      `/repos/${metadata.repo}/commits?${params}`,
      token,
    );
    if (commits.length === 0) {
      return {
        section: emptySection(
          'deploy',
          'empty',
          `no commits in the ${DEPLOY_WINDOW_MINUTES} min before the alert`,
        ),
        extra: { recentDeploy: null },
      };
    }

    const detailed = await Promise.allSettled(
      commits
        .slice(0, DETAILED_COMMITS)
        .map((c) => this.get<GitHubCommit>(`/repos/${metadata.repo}/commits/${c.sha}`, token)),
    );
    const withFiles = commits.map((c, i) => {
      const d = detailed[i];
      return d && d.status === 'fulfilled' ? d.value : c;
    });

    const infos = withFiles.map((c) => this.toDeployInfo(c, incident.detectedAt));
    const lines = withFiles.map((c, i) => this.render(c, infos[i]));
    return {
      section: { source: 'deploy', status: 'ok', lines },
      extra: { recentDeploy: infos[0] ?? null },
    };
  }

  private toDeployInfo(c: GitHubCommit, alertAt: Date): DeployInfo {
    const committedAt = c.commit.author?.date ?? alertAt.toISOString();
    return {
      sha: c.sha,
      author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
      message: c.commit.message.split('\n')[0],
      committedAt,
      minutesBeforeAlert: minutesBetween(new Date(committedAt), alertAt),
      url: c.html_url ?? null,
      highSignalFiles: (c.files ?? []).map((f) => f.filename).filter(isHighSignalFile),
    };
  }

  private render(c: GitHubCommit, info: DeployInfo): string {
    const files = (c.files ?? [])
      .slice(0, 8)
      .map((f) => `${f.filename} (+${f.additions ?? 0}/-${f.deletions ?? 0})`)
      .join(', ');
    let line = `commit ${c.sha.slice(0, 7)} by ${info.author} at ${hhmmUtc(new Date(info.committedAt))} (${info.minutesBeforeAlert} min before alert): "${info.message}"`;
    if (files) line += ` — files: ${files}`;
    if (info.highSignalFiles.length)
      line += ` — high-signal: ${info.highSignalFiles.slice(0, 5).join(', ')}`;
    return sanitizeLine(line, 700);
  }

  private async get<T>(path: string, token: string): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'sre-ai',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${path.split('?')[0]} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}
