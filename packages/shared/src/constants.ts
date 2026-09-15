export const SQS_QUEUE_NAMES = {
  P1: 'sreai-incidents-p1',
  P2: 'sreai-incidents-p2',
  DLQ: 'sreai-incidents-dlq',
} as const;

export const DEDUPLICATION_TTL_SECONDS = 300;

export const CONFIDENCE_THRESHOLDS = {
  AUTO: 0.85,
  DRAFT: 0.6,
} as const;

export const CITATION_INVALID_RATIO_CAP = 0.3;
export const CITATION_CAPPED_CONFIDENCE = 0.35;

export const DLQ_MAX_RECEIVE_COUNT = 3;
