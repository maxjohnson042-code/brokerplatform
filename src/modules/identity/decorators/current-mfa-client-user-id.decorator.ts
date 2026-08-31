import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Set by MfaPendingGuard from the mfa_pending/mfa_enrolment_pending token's claims.
export const CurrentMfaClientUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().mfaClientUserId;
});
