import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

// Per-request / per-job context carried implicitly through async calls so
// every log line can include traceId + tenantId (CLAUDE.md rule #6) without
// threading them through every function signature.
export interface TraceContext {
  traceId: string;
  tenantId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

// Mutates the active context in place — used once auth has resolved the
// tenant for a request that started without one.
export function updateTraceContext(patch: Partial<TraceContext>): void {
  const current = storage.getStore();
  if (current) {
    Object.assign(current, patch);
  }
}

export function newTraceId(): string {
  return randomUUID();
}

const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

// Accept an upstream trace id only if it looks like one — it ends up in
// logs and response headers, so arbitrary client input is not trusted.
export function sanitizeTraceId(candidate: string | undefined | null): string {
  if (candidate && TRACE_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return newTraceId();
}
