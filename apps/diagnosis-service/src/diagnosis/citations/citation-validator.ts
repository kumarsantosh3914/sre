import {
  CITATION_INVALID_RATIO_CAP,
  DiagnosisOutput,
  MIN_VERIFIABLE_REFERENCE_LENGTH,
} from '@sreai/shared';
import { CONTEXT_SOURCES, ContextSource } from '../context/context.types';
import { RenderedContext } from '../context/context-renderer';

export type CitationFailureReason =
  'not_found' | 'source_mismatch' | 'too_short' | 'unknown_source';

export interface CitationCheck {
  origin: 'evidence' | 'inline';
  claim: string;
  source: string;
  reference: string;
  valid: boolean;
  reason?: CitationFailureReason;
  // For source_mismatch: where the reference actually appears.
  foundIn?: ContextSource;
}

export interface CitationValidationResult {
  checks: CitationCheck[];
  total: number;
  invalid: number;
  failureRate: number;
  // false when more than CITATION_INVALID_RATIO_CAP of citations are
  // invalid → confidence is capped and the incident escalates.
  passed: boolean;
}

// Whitespace is collapsed on both sides (models re-flow whitespace; that
// isn't fabrication). Everything else must match exactly, case-sensitive.
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Models often echo the line label ("[L12] …") or wrap quotes around the
// excerpt; neither is part of the evidence itself.
const QUOTES = /^["'`“”]+|["'`“”]+$/g;
const LINE_LABEL = /^\[[LMDHS]\d+\]\s*/;

export function cleanReference(reference: string): string {
  return normalize(
    reference.trim().replace(QUOTES, '').trim().replace(LINE_LABEL, '').replace(QUOTES, ''),
  );
}

// [SOURCE: logs, <verbatim excerpt>] tags inside hypothesis / reasoning.
const INLINE_TAG = /\[SOURCE:\s*([a-z_]+)\s*,\s*([^\]]+?)\s*\]/gi;

export function extractInlineCitations(text: string): { source: string; reference: string }[] {
  const out: { source: string; reference: string }[] = [];
  for (const match of text.matchAll(INLINE_TAG)) {
    out.push({ source: match[1].toLowerCase(), reference: match[2] });
  }
  return out;
}

function isContextSource(value: string): value is ContextSource {
  return (CONTEXT_SOURCES as readonly string[]).includes(value);
}

export class CitationValidator {
  validate(output: DiagnosisOutput, context: RenderedContext): CitationValidationResult {
    const haystacks = Object.fromEntries(
      CONTEXT_SOURCES.map((s) => [s, normalize(context.sections[s].join('\n'))]),
    ) as Record<ContextSource, string>;

    const candidates: Omit<CitationCheck, 'valid' | 'reason' | 'foundIn'>[] = [
      ...output.evidence.map((e) => ({
        origin: 'evidence' as const,
        claim: e.claim,
        source: e.source,
        reference: e.reference,
      })),
      ...[output.hypothesis, output.reasoning].flatMap((text) =>
        extractInlineCitations(text).map((c) => ({
          origin: 'inline' as const,
          claim: text.slice(0, 200),
          source: c.source,
          reference: c.reference,
        })),
      ),
    ];

    const checks = candidates.map((c) => this.check(c, haystacks));
    const invalid = checks.filter((c) => !c.valid).length;
    const total = checks.length;
    // No citations at all is maximal failure, not a vacuous pass.
    const failureRate = total === 0 ? 1 : invalid / total;
    return {
      checks,
      total,
      invalid,
      failureRate,
      passed: failureRate <= CITATION_INVALID_RATIO_CAP,
    };
  }

  private check(
    candidate: Omit<CitationCheck, 'valid' | 'reason' | 'foundIn'>,
    haystacks: Record<ContextSource, string>,
  ): CitationCheck {
    const reference = cleanReference(candidate.reference);
    if (!isContextSource(candidate.source)) {
      return { ...candidate, valid: false, reason: 'unknown_source' };
    }
    if (reference.length < MIN_VERIFIABLE_REFERENCE_LENGTH) {
      return { ...candidate, valid: false, reason: 'too_short' };
    }
    if (haystacks[candidate.source].includes(reference)) {
      return { ...candidate, valid: true };
    }
    const foundIn = CONTEXT_SOURCES.find((s) => haystacks[s].includes(reference));
    return foundIn
      ? { ...candidate, valid: false, reason: 'source_mismatch', foundIn }
      : { ...candidate, valid: false, reason: 'not_found' };
  }
}
