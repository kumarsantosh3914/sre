import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtAccessPayload } from '@sreai/shared';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtAccessPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtAccessPayload }>();
    return request.user;
  },
);
