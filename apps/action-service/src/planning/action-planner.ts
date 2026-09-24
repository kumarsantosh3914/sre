import { ExecutableActionType, ActionType, ServiceMetadata } from '@sreai/shared';

// The LLM is prompted to start recommended_action with one of these verbs
// (see diagnosis prompt v1). Anything else — including INVESTIGATE — is
// "no automated action", never a guess.
const VERB_TO_TYPE: Record<string, ExecutableActionType | null> = {
  RESTART_SERVICE: ActionType.RESTART_SERVICE,
  SCALE_SERVICE: ActionType.SCALE_SERVICE,
  FLUSH_CACHE: ActionType.FLUSH_CACHE,
  REDEPLOY: ActionType.REDEPLOY,
  INVESTIGATE: null,
};

export interface ClassifiedAction {
  type: ExecutableActionType | null;
  // Why no executable type was chosen (shown to humans).
  reason?: string;
}

// Deterministic mapping from the model's free-text recommendation to one
// allowlisted handler. The explicit verb prefix is authoritative; without
// it, keyword matching must be unambiguous (exactly one handler) or the
// action is treated as non-executable.
export function classifyRecommendedAction(recommendation: string): ClassifiedAction {
  const prefix = recommendation.trim().match(/^([A-Z_]+)\s*:/)?.[1];
  if (prefix && prefix in VERB_TO_TYPE) {
    const type = VERB_TO_TYPE[prefix];
    return type ? { type } : { type: null, reason: 'diagnosis recommends manual investigation' };
  }

  const text = recommendation.toLowerCase();
  const matches = new Set<ExecutableActionType>();
  if (/\brestart|\breboot|\bbounce\b|force new deployment/.test(text))
    matches.add(ActionType.RESTART_SERVICE);
  if (
    /\bscale (up|out)|add (a |one |1 )?(task|instance|replica)|increase (the )?(desired|replica|task) count/.test(
      text,
    )
  ) {
    matches.add(ActionType.SCALE_SERVICE);
  }
  if (/\b(flush|clear|purge|invalidate)\b.*\bcache\b|\bcache\b.*\b(flush|clear|purge)/.test(text)) {
    matches.add(ActionType.FLUSH_CACHE);
  }
  if (/\bredeploy|\bre-deploy|\broll ?back\b|\brevert\b/.test(text))
    matches.add(ActionType.REDEPLOY);

  if (matches.size === 1) return { type: [...matches][0] };
  return {
    type: null,
    reason:
      matches.size === 0
        ? 'no supported automated action matches the recommendation'
        : 'recommendation matches more than one action type',
  };
}

// Picks which allowlisted cache pattern a FLUSH_CACHE recommendation means.
export function pickCachePattern(recommendation: string, metadata: ServiceMetadata): string | null {
  const patterns = metadata.cacheFlushPatterns ?? [];
  const mentioned = patterns.filter((p) => recommendation.includes(p));
  if (mentioned.length === 1) return mentioned[0];
  if (mentioned.length === 0 && patterns.length === 1) return patterns[0];
  return null;
}
