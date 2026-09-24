import { NextFunction, Request, Response } from 'express';
import { runWithTraceContext, sanitizeTraceId } from '../context/trace-context';

export const TRACE_ID_HEADER = 'x-trace-id';

// Starts a trace context for every HTTP request. Everything downstream of
// next() — guards, pipes, handlers, and the async work they await — runs
// inside it, so logs pick up the traceId automatically.
export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = sanitizeTraceId(req.header(TRACE_ID_HEADER));
  res.setHeader(TRACE_ID_HEADER, traceId);
  runWithTraceContext({ traceId }, () => next());
}
