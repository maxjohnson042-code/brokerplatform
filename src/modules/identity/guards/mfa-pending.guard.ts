import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityService, MfaPendingTokenClaims } from '../identity.service';

export const MFA_PENDING_TYPE_KEY = 'mfaPendingType';
export const MfaPendingType = (type: MfaPendingTokenClaims['tokenType']) => SetMetadata(MFA_PENDING_TYPE_KEY, type);

/**
 * Accepts ONLY the narrow mfa_pending / mfa_enrolment_pending token minted by
 * IdentityService.loginClientUser — never a full access token (JwtAuthGuard's
 * tokenType check rejects this token type the other way). Attaches
 * request.mfaClientUserId for the controller to use. This pairing is the actual
 * enforcement mechanism for AUTH-006's "mandatory": there is no code path from a
 * client_user's credentials to a full access token that skips this guard.
 */
@Injectable()
export class MfaPendingGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.reflector.get<MfaPendingTokenClaims['tokenType']>(
      MFA_PENDING_TYPE_KEY,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');

    try {
      const claims = this.identity.verifyMfaPendingToken(authHeader.slice('Bearer '.length), expected);
      request.mfaClientUserId = claims.clientUserId;
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired MFA session token');
    }
  }
}
