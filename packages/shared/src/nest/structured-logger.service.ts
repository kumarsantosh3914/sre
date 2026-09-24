import { LoggerService } from '@nestjs/common';
import { Logger as WinstonLogger } from 'winston';
import { LogMeta, errorMeta } from '../logger';

type Level = 'info' | 'warn' | 'error' | 'debug' | 'verbose';

// Nest LoggerService backed by winston that understands this codebase's
// `this.logger.log('message', { traceId, tenantId, ... })` convention.
//
// Nest's Logger forwards `(message, ...params, contextName)`; nest-winston
// would treat the meta object as the context string and nest it under a
// `context` key, dropping the class name. Here every plain-object param is
// flattened into top-level meta, an Error becomes error/stack fields, and a
// trailing string is the context (class) name — so log lines stay
// queryable by traceId/tenantId at the top level.
export class NestStructuredLogger implements LoggerService {
  constructor(private readonly winston: WinstonLogger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('error', message, [...params, { fatal: true }]);
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    const meta: LogMeta = {};
    const rest = [...params];

    // Nest appends the context name last when the Logger has one.
    if (rest.length > 0 && typeof rest[rest.length - 1] === 'string') {
      meta.context = rest.pop();
    }

    for (const param of rest) {
      if (param === undefined || param === null) continue;
      if (param instanceof Error) {
        Object.assign(meta, errorMeta(param));
      } else if (typeof param === 'object') {
        Object.assign(meta, param as LogMeta);
      } else if (typeof param === 'string') {
        // Nest's own error(message, stack, context) form.
        meta.stack = param;
      } else {
        meta.detail = param;
      }
    }

    if (message instanceof Error) {
      Object.assign(meta, errorMeta(message));
      this.winston.log(level, message.message, meta);
      return;
    }
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    this.winston.log(level, text, meta);
  }
}
