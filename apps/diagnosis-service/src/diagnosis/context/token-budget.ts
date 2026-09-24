import { ContextSection, ContextSource } from './context.types';

// Conservative estimate (~3.5 chars/token for log-ish English) — errs
// toward sending less rather than overflowing the budget.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// Truncation priority from the build guide: similar incidents > logs >
// metrics > deploy > dependencies. Each section first gets its weighted
// share; leftover budget is then handed out in priority order.
const PRIORITY: ContextSource[] = ['similar_incident', 'logs', 'metrics', 'deploy', 'dependency'];
const WEIGHTS: Record<ContextSource, number> = {
  similar_incident: 0.2,
  logs: 0.4,
  metrics: 0.2,
  deploy: 0.1,
  dependency: 0.1,
};

function sectionTokens(lines: string[]): number {
  return lines.reduce((sum, line) => sum + estimateTokens(line) + 1, 0);
}

// Logs keep their head and tail (startup errors + most recent activity);
// other sections are cut from the end.
function fitLines(source: ContextSource, lines: string[], budget: number): string[] {
  if (sectionTokens(lines) <= budget) return lines;
  if (source !== 'logs') {
    const kept: string[] = [];
    let used = 0;
    for (const line of lines) {
      const cost = estimateTokens(line) + 1;
      if (used + cost > budget) break;
      kept.push(line);
      used += cost;
    }
    return kept;
  }
  const head: string[] = [];
  const tail: string[] = [];
  let used = estimateTokens('[… lines omitted …]') + 1;
  let h = 0;
  let t = lines.length - 1;
  // 1 head line for every 3 tail lines.
  let turn = 0;
  while (h <= t) {
    const takeHead = turn % 4 === 0;
    const line = takeHead ? lines[h] : lines[t];
    const cost = estimateTokens(line) + 1;
    if (used + cost > budget) break;
    used += cost;
    if (takeHead) {
      head.push(line);
      h += 1;
    } else {
      tail.unshift(line);
      t -= 1;
    }
    turn += 1;
  }
  const omitted = lines.length - head.length - tail.length;
  return omitted > 0 ? [...head, `[… ${omitted} lines omitted …]`, ...tail] : [...head, ...tail];
}

export function applyTokenBudget(
  sections: Record<ContextSource, ContextSection>,
  budget: number,
): Record<ContextSource, ContextSection> {
  const need = Object.fromEntries(
    PRIORITY.map((s) => [s, sectionTokens(sections[s].lines)]),
  ) as Record<ContextSource, number>;

  const alloc = Object.fromEntries(
    PRIORITY.map((s) => [s, Math.min(need[s], Math.floor(budget * WEIGHTS[s]))]),
  ) as Record<ContextSource, number>;

  let leftover = budget - PRIORITY.reduce((sum, s) => sum + alloc[s], 0);
  for (const source of PRIORITY) {
    if (leftover <= 0) break;
    const extra = Math.min(leftover, need[source] - alloc[source]);
    alloc[source] += extra;
    leftover -= extra;
  }

  const out = {} as Record<ContextSource, ContextSection>;
  for (const source of PRIORITY) {
    out[source] = {
      ...sections[source],
      lines: fitLines(source, sections[source].lines, alloc[source]),
    };
  }
  return out;
}
