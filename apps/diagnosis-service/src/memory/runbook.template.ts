import { Diagnosis, Incident } from '@sreai/database';
import { mdText } from './postmortem.template';

export interface RunbookInput {
  alertTitle: string;
  serviceName: string;
  actionType: string;
  actionDescription: string;
  incidents: Incident[];
  diagnoses: Diagnosis[];
  prevention: string[];
  successes: number;
  occurrences: number;
}

const ACTION_STEPS: Record<string, string[]> = {
  restart_service: [
    'Confirm no deploy went out in the last 30 minutes (a restart will not undo a bad deploy).',
    'Trigger a rolling restart of the service (ECS: force new deployment).',
    'Watch error rate and health checks for 5 minutes after tasks are replaced.',
  ],
  scale_service: [
    'Confirm the service is CPU/throughput bound (not blocked on a dependency).',
    'Scale out by one task, staying under the configured maximum.',
    'Verify latency and error rate recover; scale back once the spike passes.',
  ],
  flush_cache: [
    'Confirm the symptom matches stale/poisoned cache entries in the logs.',
    'Flush only the affected key pattern — never the whole cache.',
    'Verify the entries repopulate with correct values.',
  ],
  redeploy: [
    'Identify the deploy that preceded the incident and what it changed.',
    'Re-run the deploy workflow (or roll back to the last good revision).',
    'Verify the service is healthy on the new revision.',
  ],
};

function topEvidence(diagnoses: Diagnosis[]): string[] {
  const counts = new Map<string, number>();
  for (const d of diagnoses) {
    for (const e of d.evidence) {
      const key = `${e.source}: ${e.claim}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);
}

// Deterministic runbook from what actually worked (3+ successful
// resolutions of the same alert signature with the same action) — no LLM,
// so it only ever states what the incident history shows.
export function renderRunbook(input: RunbookInput): string {
  const steps = ACTION_STEPS[input.actionType] ?? [`Apply: ${input.actionDescription}`];
  const checks = topEvidence(input.diagnoses);
  const rootCauses = [...new Set(input.diagnoses.map((d) => mdText(d.hypothesis)))].slice(0, 3);

  return [
    `# Runbook: ${mdText(input.alertTitle)} on ${mdText(input.serviceName)}`,
    '',
    `_Generated from ${input.occurrences} past incidents; "${mdText(input.actionDescription)}" resolved it ${input.successes} times._`,
    '',
    '## When this applies',
    '',
    `- Alert **${mdText(input.alertTitle)}** fires for **${mdText(input.serviceName)}**.`,
    '',
    '## Diagnosis — what to check',
    '',
    ...(checks.length
      ? checks.map((c) => `- ${mdText(c)}`)
      : ['- Review recent logs, metrics and deploys for the service.']),
    '',
    '## Known root causes',
    '',
    ...(rootCauses.length ? rootCauses.map((r) => `- ${r}`) : ['- Not recorded.']),
    '',
    '## Resolution',
    '',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Prevention',
    '',
    ...(input.prevention.length
      ? input.prevention.map((p) => `- ${mdText(p)}`)
      : ['- See the linked post-mortems.']),
    '',
    '## History',
    '',
    '| Incident | Detected | MTTR |',
    '| --- | --- | --- |',
    ...input.incidents.map(
      (i) =>
        `| ${i.id.slice(0, 8)} | ${i.detectedAt.toISOString().slice(0, 16).replace('T', ' ')} | ${i.mttrSeconds ?? '?'}s |`,
    ),
    '',
  ].join('\n');
}
