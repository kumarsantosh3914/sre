import { CITATION_CAPPED_CONFIDENCE } from '@sreai/shared';
import { CitationValidationResult } from '../citations/citation-validator';
import { DiagnosisContext } from '../context/context.types';

export interface ScoreBreakdown {
  llmConfidence: number;
  final: number;
  adjustments: { reason: string; effect: string }[];
  capped: boolean;
}

const DEPLOY_BOOST = 0.1;
const SIMILAR_BOOST = 0.05;
const PATTERN_BOOST = 0.05;
const NO_LOGS_PENALTY = 0.7;
// A learned pattern only counts once it has a track record.
const PATTERN_MIN_OCCURRENCES = 3;
const PATTERN_MIN_SUCCESS_RATE = 0.8;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// The LLM's self-reported confidence adjusted for evidence quality (build
// guide Day 19). The citation cap is applied LAST, so no boost can ever
// lift a diagnosis that failed citation enforcement above the cap.
export function scoreConfidence(
  llmConfidence: number,
  citations: CitationValidationResult,
  context: DiagnosisContext,
): ScoreBreakdown {
  const adjustments: ScoreBreakdown['adjustments'] = [];
  let score = clamp(llmConfidence);

  if (citations.failureRate > 0) {
    score *= 1 - citations.failureRate;
    adjustments.push({
      reason: `${citations.invalid}/${citations.total} citations invalid`,
      effect: `×${round(1 - citations.failureRate)}`,
    });
  }
  if (context.recentDeploy) {
    score = Math.min(score + DEPLOY_BOOST, 1);
    adjustments.push({ reason: 'deploy within correlation window', effect: `+${DEPLOY_BOOST}` });
  }
  if (context.similarIncidents.length > 0) {
    score = Math.min(score + SIMILAR_BOOST, 1);
    adjustments.push({ reason: 'similar resolved incident found', effect: `+${SIMILAR_BOOST}` });
  }
  const pattern = context.pattern;
  if (
    pattern &&
    pattern.occurrences >= PATTERN_MIN_OCCURRENCES &&
    pattern.successes / pattern.occurrences >= PATTERN_MIN_SUCCESS_RATE
  ) {
    score = Math.min(score + PATTERN_BOOST, 1);
    adjustments.push({
      reason: `known resolution pattern (${pattern.successes}/${pattern.occurrences} successful)`,
      effect: `+${PATTERN_BOOST}`,
    });
  }
  if (context.sections.logs.lines.length === 0) {
    score *= NO_LOGS_PENALTY;
    adjustments.push({ reason: 'no logs available', effect: `×${NO_LOGS_PENALTY}` });
  }

  let capped = false;
  if (!citations.passed && score > CITATION_CAPPED_CONFIDENCE) {
    score = CITATION_CAPPED_CONFIDENCE;
    capped = true;
    adjustments.push({
      reason: 'citation enforcement failed (>30% invalid)',
      effect: `capped at ${CITATION_CAPPED_CONFIDENCE}`,
    });
  }

  return { llmConfidence, final: round(clamp(score)), adjustments, capped };
}
