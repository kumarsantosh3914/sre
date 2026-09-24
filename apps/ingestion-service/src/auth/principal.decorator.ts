import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiKeyPrincipal } from './api-key-auth.service';
import { ApiKeyRequest } from './api-key.guard';

export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyPrincipal => {
    const principal = ctx.switchToHttp().getRequest<ApiKeyRequest>().principal;
    if (!principal) {
      // Only reachable if a route forgot ApiKeyGuard — fail closed.
      throw new InternalServerErrorException('Route is missing ApiKeyGuard');
    }
    return principal;
  },
);
