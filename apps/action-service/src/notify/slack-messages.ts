import { Action, Diagnosis, Incident } from '@sreai/database';
import { SlackBlock, SlackMessage } from './slack.client';

export const SLACK_ACTION_IDS = {
  APPROVE: 'sreai_approve',
  REJECT: 'sreai_reject',
  ROLLBACK: 'sreai_rollback',
} as const;

export interface ButtonValue {
  tenantId: string;
  incidentId: string;
  actionId: string;
}

const SEVERITY_LABEL: Record<string, string> = { p1: 'P1', p2: 'P2', p3: 'P3' };

// Slack mrkdwn: escape the three control characters so incident text from
// customer systems can't inject links or mentions.
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function incidentLink(dashboardUrl: string | undefined, incident: Incident): string {
  const title = escapeMrkdwn(truncate(incident.title, 150));
  return dashboardUrl ? `<${dashboardUrl}/incidents/${incident.id}|${title}>` : `*${title}*`;
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: truncate(text, 2900) } };
}

function context(text: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: truncate(text, 2900) }] };
}

function header(incident: Incident, serviceName: string): string {
  return `${SEVERITY_LABEL[incident.severity] ?? incident.severity} · ${escapeMrkdwn(serviceName)}`;
}

function evidenceList(diagnosis: Diagnosis, max = 4): string {
  return diagnosis.evidence
    .slice(0, max)
    .map(
      (e) =>
        `• ${escapeMrkdwn(truncate(e.claim, 200))} — _${e.source}_: \`${escapeMrkdwn(truncate(e.reference, 150))}\``,
    )
    .join('\n');
}

function confidence(diagnosis: Diagnosis): string {
  const pct = Math.round(diagnosis.confidence * 100);
  const citations = diagnosis.citationsPassed ? 'citations verified' : 'citation check FAILED';
  return `Confidence *${pct}%* · ${citations}`;
}

function button(
  text: string,
  actionId: string,
  value: ButtonValue,
  style?: 'primary' | 'danger',
): SlackBlock {
  return {
    type: 'button',
    text: { type: 'plain_text', text },
    action_id: actionId,
    value: JSON.stringify(value),
    ...(style ? { style } : {}),
  };
}

export interface MessageContext {
  incident: Incident;
  serviceName: string;
  dashboardUrl?: string;
}

export function incidentOpenedMessage(ctx: MessageContext): SlackMessage {
  return {
    text: `Incident opened: ${ctx.incident.title}`,
    blocks: [
      section(
        `:rotating_light: *Incident opened* — ${incidentLink(ctx.dashboardUrl, ctx.incident)}`,
      ),
      context(
        `${header(ctx.incident, ctx.serviceName)} · SRE.ai is collecting context and diagnosing…`,
      ),
    ],
  };
}

export function autoExecutedMessage(
  ctx: MessageContext,
  diagnosis: Diagnosis,
  action: Action,
): SlackMessage {
  const value = { tenantId: action.tenantId, incidentId: action.incidentId, actionId: action.id };
  return {
    text: `Auto-executed: ${action.description}`,
    blocks: [
      section(
        `:white_check_mark: *Auto-executed:* ${escapeMrkdwn(action.description)}\n${incidentLink(ctx.dashboardUrl, ctx.incident)}`,
      ),
      section(`*Root cause:* ${escapeMrkdwn(diagnosis.hypothesis)}\n${confidence(diagnosis)}`),
      section(evidenceList(diagnosis)),
      {
        type: 'actions',
        elements: [button('Roll back', SLACK_ACTION_IDS.ROLLBACK, value, 'danger')],
      },
      context(`${header(ctx.incident, ctx.serviceName)} · Rollback available for 1 hour`),
    ],
  };
}

export function approvalMessage(
  ctx: MessageContext,
  diagnosis: Diagnosis,
  action: Action,
): SlackMessage {
  const value = { tenantId: action.tenantId, incidentId: action.incidentId, actionId: action.id };
  return {
    text: `Approval needed: ${action.description}`,
    blocks: [
      section(
        `:large_yellow_circle: *Approval needed* — ${incidentLink(ctx.dashboardUrl, ctx.incident)}`,
      ),
      section(`*Proposed action:* ${escapeMrkdwn(action.description)}`),
      section(`*Root cause:* ${escapeMrkdwn(diagnosis.hypothesis)}\n${confidence(diagnosis)}`),
      section(evidenceList(diagnosis)),
      {
        type: 'actions',
        elements: [
          button('Approve', SLACK_ACTION_IDS.APPROVE, value, 'primary'),
          button('Reject', SLACK_ACTION_IDS.REJECT, value, 'danger'),
        ],
      },
      context(
        `${header(ctx.incident, ctx.serviceName)} · Escalates automatically if nobody decides within 30 minutes`,
      ),
    ],
  };
}

export function decisionMessage(
  ctx: MessageContext,
  action: Action,
  outcome: string,
): SlackMessage {
  return {
    text: `${action.description}: ${outcome}`,
    blocks: [
      section(
        `*${escapeMrkdwn(action.description)}* — ${escapeMrkdwn(outcome)}\n${incidentLink(ctx.dashboardUrl, ctx.incident)}`,
      ),
      context(header(ctx.incident, ctx.serviceName)),
    ],
  };
}

export interface EscalationPacket {
  reason: string;
  diagnosis: Diagnosis | null;
  similar: { title: string; mttrSeconds: number | null; actionTaken: string | null }[];
  runbookTitle: string | null;
  enrichment: Record<string, unknown>;
}

// The escalation "context packet": everything an on-call engineer needs to
// start without opening five dashboards.
export function escalationMessage(ctx: MessageContext, packet: EscalationPacket): SlackMessage {
  const blocks: SlackBlock[] = [
    section(`:sos: *Action required* — ${incidentLink(ctx.dashboardUrl, ctx.incident)}`),
    context(`${header(ctx.incident, ctx.serviceName)} · ${escapeMrkdwn(packet.reason)}`),
  ];
  if (packet.diagnosis) {
    blocks.push(
      section(
        `*Best hypothesis:* ${escapeMrkdwn(packet.diagnosis.hypothesis)}\n${confidence(packet.diagnosis)}`,
      ),
      section(evidenceList(packet.diagnosis)),
      section(`*Suggested next step:* ${escapeMrkdwn(packet.diagnosis.recommendedAction)}`),
    );
  } else {
    blocks.push(
      section(
        `*Alert:* ${escapeMrkdwn(ctx.incident.description ?? ctx.incident.title)}\n_No diagnosis available._`,
      ),
    );
  }
  if (packet.similar.length) {
    blocks.push(
      section(
        `*Seen before:*\n${packet.similar
          .map(
            (s) =>
              `• ${escapeMrkdwn(s.title)} — resolved in ${s.mttrSeconds ?? '?'}s${s.actionTaken ? ` by ${escapeMrkdwn(s.actionTaken)}` : ''}`,
          )
          .join('\n')}`,
      ),
    );
  }
  const extras: string[] = [];
  if (packet.runbookTitle) extras.push(`Runbook: ${escapeMrkdwn(packet.runbookTitle)}`);
  if (typeof packet.enrichment.owner === 'string')
    extras.push(`Owner: ${escapeMrkdwn(packet.enrichment.owner)}`);
  if (typeof packet.enrichment.runbookUrl === 'string')
    extras.push(`<${packet.enrichment.runbookUrl}|Service runbook>`);
  if (extras.length) blocks.push(context(extras.join(' · ')));
  return { text: `Action required: ${ctx.incident.title}`, blocks };
}

export function resolvedMessage(
  ctx: MessageContext,
  diagnosis: Diagnosis | null,
  actionTaken: string | null,
): SlackMessage {
  const mttr = ctx.incident.mttrSeconds;
  const lines = [`:white_check_mark: *Resolved* — ${incidentLink(ctx.dashboardUrl, ctx.incident)}`];
  if (diagnosis) lines.push(`*Root cause:* ${escapeMrkdwn(diagnosis.hypothesis)}`);
  lines.push(`*Fixed by:* ${escapeMrkdwn(actionTaken ?? 'alert cleared / manual resolution')}`);
  return {
    text: `Resolved: ${ctx.incident.title}`,
    blocks: [
      section(lines.join('\n')),
      context(
        `${header(ctx.incident, ctx.serviceName)}${mttr !== null ? ` · MTTR ${Math.round(mttr / 60)} min (${mttr}s)` : ''}`,
      ),
    ],
  };
}

export function rolledBackMessage(ctx: MessageContext, original: Action): SlackMessage {
  return {
    text: `Rolled back: ${original.description}`,
    blocks: [
      section(
        `:leftwards_arrow_with_hook: *Auto-execute action rolled back — human intervention required*\n${escapeMrkdwn(original.description)}\n${incidentLink(ctx.dashboardUrl, ctx.incident)}`,
      ),
      context(header(ctx.incident, ctx.serviceName)),
    ],
  };
}
