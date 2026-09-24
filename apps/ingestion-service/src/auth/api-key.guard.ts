import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { updateTraceContext } from '@sreai/shared';
import { Request } from 'express';
import { ApiKeyAuthService, ApiKeyPrincipal } from './api-key-auth.service';

export interface ApiKeyRequest extends Request {
  principal?: ApiKeyPrincipal;
}

// Webhook auth. The key may be in the URL path (what most alerting tools
// can be configured with) or, preferably, a header so it stays out of
// access logs.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly auth: ApiKeyAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyRequest>();
    const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const candidate = req.header('x-api-key') ?? bearer ?? req.params.apiKey;

    const principal = await this.auth.authenticate(candidate);
    if (!principal) {
      throw new UnauthorizedException('Invalid API key');
    }
    req.principal = principal;
    updateTraceContext({ tenantId: principal.tenantId });
    return true;
  }
}
