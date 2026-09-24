import { createLogger, format, transports, Logger } from 'winston';
import { getTraceContext } from './context/trace-context';

// Injects the active traceId/tenantId into every log line. Explicit meta
// passed at the call site wins, so a worker logging on behalf of a
// specific tenant is never overwritten by an outer context.
const traceContextFormat = format((info) => {
  const ctx = getTraceContext();
  if (ctx) {
    if (info.traceId === undefined) info.traceId = ctx.traceId;
    if (info.tenantId === undefined && ctx.tenantId) info.tenantId = ctx.tenantId;
    if (info.userId === undefined && ctx.userId) info.userId = ctx.userId;
  }
  return info;
});

export function createWinstonLogger(serviceName: string): Logger {
  return createLogger({
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    defaultMeta: { service: serviceName },
    format: format.combine(
      traceContextFormat(),
      format.timestamp(),
      format.errors({ stack: true }),
      format.json(),
    ),
    transports: [new transports.Console()],
  });
}

export type LogMeta = Record<string, unknown>;

// Minimal logger contract for framework-agnostic code (queue consumers,
// collectors) so they can take either a Nest Logger or a winston Logger.
export interface StructuredLogger {
  log(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  debug?(message: string, meta?: LogMeta): void;
}

export function errorMeta(err: unknown): LogMeta {
  if (err instanceof Error) {
    return { error: err.message, errorName: err.name, stack: err.stack };
  }
  return { error: String(err) };
}
