import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { getTraceContext } from '../context/trace-context';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  traceId: string | null;
}

export const RAW_RESPONSE_KEY = 'rawResponse';
// Opt a route out of the envelope — for callers that dictate the response
// body themselves (Slack interactivity, SNS subscription confirmation).
export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw || context.getType() !== 'http') {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        traceId: getTraceContext()?.traceId ?? null,
      })),
    );
  }
}
