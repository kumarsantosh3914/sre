import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { getTraceContext } from '../context/trace-context';
import { errorMeta } from '../logger';

export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: unknown };
  traceId: string | null;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

// Every error leaves the API in the same shape, with the traceId the
// client can quote back to us. Unexpected errors never leak internals.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }
    const res = host.switchToHttp().getResponse<Response>();
    const traceId = getTraceContext()?.traceId ?? null;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as { message?: unknown; error?: unknown };
        if (Array.isArray(record.message)) {
          message = 'Validation failed';
          details = record.message;
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
      }
    }

    if (status >= 500) {
      this.logger.error('Unhandled exception', { status, ...errorMeta(exception) });
    } else {
      this.logger.warn('Request failed', { status, message });
    }

    const envelope: ErrorEnvelope = {
      success: false,
      error: {
        code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
        message,
        ...(details !== undefined ? { details } : {}),
      },
      traceId,
    };
    res.status(status).json(envelope);
  }
}
