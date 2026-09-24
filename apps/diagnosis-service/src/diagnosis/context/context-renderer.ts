import { CONTEXT_TOKEN_BUDGET } from '@sreai/shared';
import { CONTEXT_SOURCES, ContextSection, ContextSource, DiagnosisContext } from './context.types';
import { sanitizeLine } from './sanitize';
import { applyTokenBudget } from './token-budget';

const SECTION_TITLES: Record<ContextSource, string> = {
  logs: 'LOGS',
  metrics: 'METRICS',
  deploy: 'DEPLOY',
  dependency: 'DEPENDENCIES',
  similar_incident: 'SIMILAR INCIDENTS',
};

const LINE_PREFIX: Record<ContextSource, string> = {
  logs: 'L',
  metrics: 'M',
  deploy: 'D',
  dependency: 'H',
  similar_incident: 'S',
};

// The exact text the LLM receives, plus each section's lines on their own
// — the citation validator checks references against these, so "present
// in the context" means present in precisely what the model saw.
export interface RenderedContext {
  prompt: string;
  sections: Record<ContextSource, string[]>;
}

function renderSection(section: ContextSection): { text: string; lines: string[] } {
  const title = SECTION_TITLES[section.source];
  const lines = section.lines.map((line, i) => `[${LINE_PREFIX[section.source]}${i + 1}] ${line}`);
  const header = `<<<${title} source="${section.source}" status="${section.status}">>>`;
  const body =
    lines.length > 0 ? lines.join('\n') : `(no data${section.note ? `: ${section.note}` : ''})`;
  return { text: `${header}\n${body}\n<<<END ${title}>>>`, lines: section.lines };
}

export function renderContext(
  context: DiagnosisContext,
  tokenBudget: number = CONTEXT_TOKEN_BUDGET,
): RenderedContext {
  const budgeted = applyTokenBudget(context.sections, tokenBudget);
  const { incident } = context;
  const labels = Object.entries(incident.labels)
    .slice(0, 30)
    .map(([k, v]) => `${sanitizeLine(k, 100)}=${sanitizeLine(v, 200)}`)
    .join(', ');

  const incidentBlock = [
    '<<<INCIDENT>>>',
    `title: ${sanitizeLine(incident.title)}`,
    `service: ${incident.serviceName}`,
    `severity: ${incident.severity.toUpperCase()}`,
    `detected_at: ${incident.detectedAt.toISOString()}`,
    `description: ${incident.description ? sanitizeLine(incident.description, 1000) : '(none)'}`,
    `labels: ${labels || '(none)'}`,
    '<<<END INCIDENT>>>',
  ].join('\n');

  const rendered = CONTEXT_SOURCES.map((source) => renderSection(budgeted[source]));
  const sections = Object.fromEntries(
    CONTEXT_SOURCES.map((source, i) => [source, rendered[i].lines]),
  ) as Record<ContextSource, string[]>;

  return {
    prompt: [incidentBlock, ...rendered.map((r) => r.text)].join('\n\n'),
    sections,
  };
}
