import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityService } from '../identity.service';

/**
 * Verifies the bearer access token and attaches request.authContext in exactly the
 * shape withAuthorizationContext expects (see identity.service.ts's
 * authContextFromClaims) — also attaches request.role for RolesGuard, since `role`
 * isn't part of AuthorizationContext itself (that type is deliberately minimal, shared
 * with non-HTTP callers like scripts/demo-tenancy.ts).
 *
 * Rejects anything that isn't a `tokenType: 'access'` JWT — an mfa_pending or
 * mfa_enrolment_pending token (see MfaPendingGuard) is a different, narrower-scoped
 * credential and must never be accepted here. That rejection is what makes AUTH-006's
 * "MFA mandatory" hold structurally rather than by a login-service check someone could
 * forget to call.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');

    try {
      const claims = this.identity.verifyAccessToken(authHeader.slice('Bearer '.length));
      request.authContext = this.identity.authContextFromClaims(claims);
      request.role = claims.role;
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired access token');
    }
  }
}
