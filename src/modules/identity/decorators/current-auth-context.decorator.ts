import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthorizationContext } from '../../../db/authorization-context';

// Set by JwtAuthGuard, in exactly the shape withAuthorizationContext expects — so a
// controller handler can pass this straight into a repository call without
// reconstructing it, the same way scripts/demo-tenancy.ts constructs one by hand.
export const CurrentAuthContext = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthorizationContext => {
  return ctx.switchToHttp().getRequest().authContext;
});
