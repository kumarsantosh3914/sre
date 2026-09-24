import { Action, AuditLog, Diagnosis, Incident } from '@sreai/database';
import { ActionStatus, ActionType } from '@sreai/shared';

export interface PostmortemInput {
  incident: Incident;
  serviceName: string;
  diagnosis: Diagnosis | null;
  actions: Action[];
  timeline: AuditLog[];
  prevention: string[];
}

// Markdown is rendered from customer-controlled text (alert titles, log
// excerpts); keep it inert: no raw HTML, no accidental headings/tables.
export function mdText(text: string): string {
  return text
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .replace(/\r?\n/g, ' ')
    .trim();
}

function duration(seconds: number | null): string {
  if (seconds === null) return 'n/a';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const EVENT_LABELS: Record<string, string> = {
  'incident.created': 'Alert received, incident opened',
  'incident.storm_opened': 'Alert storm detected, incident opened',
  'incident.status_changed': 'Status changed',
  'diagnosis.completed': 'Diagnosis completed',
  'diagnosis.failed': 'Automated diagnosis failed',
  'action.started': 'Action started',
  'action.approval_requested': 'Approval requested',
  'action.approved': 'Action approved',
  'action.rejected': 'Action rejected',
  'action.expired': 'Approval expired',
  'action.executed': 'Action executed',
  'action.failed': 'Action failed',
  'action.rolled_back': 'Action rolled back',
  'incident.escalated': 'Escalated to on-call',
  'incident.resolved': 'Resolved',
};

function timelineLine(e: AuditLog): string {
  const at = e.createdAt.toISOString().replace('T', ' ').slice(0, 19);
  const label = EVENT_LABELS[e.event] ?? e.event;
  const detail =
    typeof e.metadata.reason === 'string'
      ? ` — ${mdText(e.metadata.reason)}`
      : typeof e.metadata.description === 'string'
        ? ` — ${mdText(e.metadata.description)}`
        : e.after && typeof e.after.status === 'string'
          ? ` (→ ${e.after.status})`
          : '';
  const actor =
    e.actorType === 'system'
      ? 'SRE.ai'
      : `${e.actorType}${e.actorId ? `:${e.actorId.slice(0, 8)}` : ''}`;
  return `| ${at} UTC | ${label}${detail} | ${actor} |`;
}

// Build guide Day 27-28 structure: header, timeline (from the audit log),
// root cause, evidence with citations, action taken, prevention.
export function renderPostmortem(input: PostmortemInput): string {
  const { incident, diagnosis, actions, timeline, prevention } = input;
  const fixes = actions.filter(
    (a) => a.actionType !== ActionType.ESCALATE && a.actionType !== ActionType.NOTIFY,
  );
  const lines: string[] = [
    `# Post-Mortem: ${mdText(incident.title)}`,
    '',
    `**Date:** ${incident.detectedAt.toISOString().slice(0, 10)}  `,
    `**Severity:** ${incident.severity.toUpperCase()}  `,
    `**Service:** ${mdText(input.serviceName)}  `,
    `**Detected:** ${incident.detectedAt.toISOString()}  `,
    `**Resolved:** ${incident.resolvedAt?.toISOString() ?? 'n/a'}  `,
    `**MTTR:** ${duration(incident.mttrSeconds)}`,
    '',
    '## Summary',
    '',
    diagnosis
      ? mdText(diagnosis.hypothesis)
      : mdText(incident.description ?? 'No automated diagnosis was produced for this incident.'),
    '',
    '## Timeline',
    '',
    '| Time | Event | Actor |',
    '| --- | --- | --- |',
    ...timeline.map(timelineLine),
    '',
    '## Root Cause',
    '',
  ];

  if (diagnosis) {
    lines.push(
      mdText(diagnosis.hypothesis),
      '',
      `Confidence: ${Math.round(diagnosis.confidence * 100)}% · Citations ${diagnosis.citationsPassed ? 'verified' : 'failed verification — treat with caution'}`,
      '',
      '## Evidence',
      '',
      ...diagnosis.evidence.map(
        (e) =>
          `- ${mdText(e.claim)} — *${e.source}*: \`${mdText(e.reference).replace(/`/g, "'")}\``,
      ),
      '',
    );
  } else {
    lines.push('Undetermined — no diagnosis was available.', '');
  }

  lines.push('## Action Taken', '');
  if (fixes.length === 0) {
    lines.push(
      incident.resolutionNote
        ? `Resolved manually: ${mdText(incident.resolutionNote)}`
        : 'No automated action was taken; the alert cleared or was resolved by the team.',
    );
  } else {
    for (const a of fixes) {
      const outcome =
        a.status === ActionStatus.EXECUTED
          ? 'success'
          : a.status === ActionStatus.ROLLED_BACK
            ? 'rolled back'
            : a.status;
      lines.push(
        `- ${mdText(a.description)} — Outcome: ${outcome}${a.error ? ` (${mdText(a.error)})` : ''}`,
      );
    }
  }
  lines.push('', '## Prevention', '');
  lines.push(
    ...(prevention.length
      ? prevention.map((p, i) => `${i + 1}. ${mdText(p)}`)
      : ['_Prevention suggestions unavailable._']),
  );
  lines.push(
    '',
    '---',
    '_Generated automatically by SRE.ai from the incident record and audit log._',
    '',
  );
  return lines.join('\n');
}
