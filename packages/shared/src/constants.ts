export const SQS_QUEUE_NAMES = {
  P1: 'sreai-incidents-p1',
  P2: 'sreai-incidents-p2',
  DLQ: 'sreai-incidents-dlq',
  // Diagnosis-service / api-gateway → action-service commands. Same
  // "SQS for durable message passing between services" rule as the
  // incident queues, with its own DLQ so action commands and incident
  // alerts never mix in a redrive.
  ACTIONS: 'sreai-actions',
  ACTIONS_DLQ: 'sreai-actions-dlq',
} as const;

// BullMQ queues (Redis-backed, in-process jobs and schedules).
export const BULLMQ_QUEUE_NAMES = {
  DIAGNOSIS: 'diagnosis',
  MEMORY: 'memory',
  APPROVAL_EXPIRY: 'approval-expiry',
  DIGEST: 'digest',
} as const;

export const DEDUPLICATION_TTL_SECONDS = 300;

// Alert storm protection: more than STORM_THRESHOLD alerts from one service
// inside STORM_WINDOW_SECONDS are grouped into a single P1 incident.
export const STORM_THRESHOLD = 20;
export const STORM_WINDOW_SECONDS = 60;
export const STORM_ACTIVE_TTL_SECONDS = 300;

export const CONFIDENCE_THRESHOLDS = {
  AUTO: 0.85,
  DRAFT: 0.6,
} as const;

export const CITATION_INVALID_RATIO_CAP = 0.3;
export const CITATION_CAPPED_CONFIDENCE = 0.35;
// A reference shorter than this is too generic to prove anything by
// substring match (e.g. "error" is present in almost any log excerpt).
export const MIN_VERIFIABLE_REFERENCE_LENGTH = 8;

export const DLQ_MAX_RECEIVE_COUNT = 3;

export const DIAGNOSIS_JOB = {
  ATTEMPTS: 3,
  BACKOFF_MS: 5_000,
  TIMEOUT_MS: 120_000,
  PRIORITY_P1: 1,
  PRIORITY_DEFAULT: 5,
} as const;

export const COLLECTOR_TIMEOUT_MS = 10_000;
export const HEALTH_CHECK_TIMEOUT_MS = 3_000;
export const LOG_LINES_LIMIT = 200;
export const LOG_WINDOW_MINUTES = 15;
export const METRICS_WINDOW_MINUTES = 30;
export const DEPLOY_WINDOW_MINUTES = 30;
export const SIMILAR_INCIDENT_LIMIT = 3;
export const SIMILARITY_THRESHOLD = 0.75;
export const CONTEXT_TOKEN_BUDGET = 8_000;

export const LLM = {
  DIAGNOSIS_MODEL: 'gpt-4o',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: 1536,
  TEMPERATURE: 0.1,
  MAX_OUTPUT_TOKENS: 1_000,
} as const;

export const APPROVAL_TTL_MS = 30 * 60 * 1000;
export const ROLLBACK_WINDOW_MS = 60 * 60 * 1000;
export const API_KEY_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;
export const RUNBOOK_MIN_OCCURRENCES = 3;

// Redis pub/sub channel the api-gateway's Socket.IO gateway relays to
// dashboards.
export const REALTIME_CHANNEL = 'sreai:events';

// SQS hard limit is 256 KiB; leave headroom for the envelope + attributes.
export const MAX_RAW_ALERT_BYTES = 200 * 1024;
