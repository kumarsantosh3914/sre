import { CONFIDENCE_THRESHOLDS } from '../constants';
import { ActionTier } from '../types';

export interface ConfidenceThresholds {
  auto: number;
  draft: number;
}

export interface RoutingOverrides {
  // Per-service "payment-service: always escalate" override. Beats any
  // confidence score.
  alwaysEscalate?: boolean;
  // Auto-execute is opt-in per service; when off, an AUTO-grade score is
  // routed to DRAFT (human approval) instead.
  autoExecuteEnabled?: boolean;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  auto: CONFIDENCE_THRESHOLDS.AUTO,
  draft: CONFIDENCE_THRESHOLDS.DRAFT,
};

export function resolveThresholds(
  tenantAuto: number | null | undefined,
  tenantDraft: number | null | undefined,
): ConfidenceThresholds {
  const auto = tenantAuto ?? DEFAULT_THRESHOLDS.auto;
  const draft = tenantDraft ?? DEFAULT_THRESHOLDS.draft;
  // A misconfigured pair (draft above auto) falls back to defaults rather
  // than producing an unreachable tier.
  if (!(draft >= 0 && auto <= 1 && draft < auto)) {
    return DEFAULT_THRESHOLDS;
  }
  return { auto, draft };
}

// > auto → AUTO, [draft, auto] → DRAFT, < draft → ESCALATE (CLAUDE.md
// Confidence Thresholds table), then per-service overrides.
export function routeActionTier(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
  overrides: RoutingOverrides = {},
): ActionTier {
  if (overrides.alwaysEscalate) {
    return ActionTier.ESCALATE;
  }
  let tier: ActionTier;
  if (confidence > thresholds.auto) {
    tier = ActionTier.AUTO;
  } else if (confidence >= thresholds.draft) {
    tier = ActionTier.DRAFT;
  } else {
    tier = ActionTier.ESCALATE;
  }
  if (tier === ActionTier.AUTO && overrides.autoExecuteEnabled === false) {
    return ActionTier.DRAFT;
  }
  return tier;
}

const TIER_RANK: Record<ActionTier, number> = {
  [ActionTier.ESCALATE]: 0,
  [ActionTier.DRAFT]: 1,
  [ActionTier.AUTO]: 2,
};

// The more cautious of two tiers — used to combine the LLM's own suggested
// tier with the score-derived one, so the model can only ever make things
// more conservative, never less.
export function mostConservativeTier(a: ActionTier, b: ActionTier): ActionTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}
