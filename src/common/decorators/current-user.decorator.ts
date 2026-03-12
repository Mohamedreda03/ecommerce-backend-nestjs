import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Extracts the authenticated user (or a specific field) from the request.
 *
 * Usage:
 *   @CurrentUser()          → full user object
 *   @CurrentUser('id')      → user.id only
 *   @CurrentUser('email')   → user.email only
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user: Record<string, unknown> }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
