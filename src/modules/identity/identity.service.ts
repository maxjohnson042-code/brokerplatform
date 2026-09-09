import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { AuthorizationContext } from '../../db/authorization-context';
import { env } from '../../config/env';
import * as repo from './identity.repository';

// Mirrors AuthorizationContext exactly, plus the token metadata JwtAuthGuard needs to
// tell an access token from an MFA-pending token from a refresh token (refresh tokens
// themselves are never JWTs — see identity.repository.ts's refresh_tokens comment).
export type AccessTokenClaims = {
  tokenType: 'access';
  actorType: repo.SessionActorType;
  actorId: string;
  clientOrganisationId?: string;
  role?: repo.ClientUserRole;
};
export type MfaPendingTokenClaims = {
  tokenType: 'mfa_pending' | 'mfa_enrolment_pending';
  clientUserId: string;
};

const ACCESS_TTL = env.auth.accessTtlSeconds;
const MFA_PENDING_TTL = 5 * 60;

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };
export type RequestMeta = { userAgent?: string; ipAddress?: string };

@Injectable()
export class IdentityService {
  constructor(private readonly jwt: JwtService) {}

  authContextFromClaims(claims: AccessTokenClaims): AuthorizationContext {
    if (claims.actorType === 'client_user') {
      return { actorType: 'client_user', actorId: claims.actorId, clientOrganisationId: claims.clientOrganisationId! };
    }
    if (claims.actorType === 'platform_admin') {
      return { actorType: 'platform_admin', actorId: claims.actorId };
    }
    return { actorType: 'broker', actorId: claims.actorId };
  }

  private async issueTokenPair(
    actorType: repo.SessionActorType,
    actorId: string,
    extra: { clientOrganisationId?: string; role?: repo.ClientUserRole },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const claims: AccessTokenClaims = { tokenType: 'access', actorType, actorId, ...extra };
    const accessToken = this.jwt.sign(claims, { secret: env.auth.jwtSecret, expiresIn: ACCESS_TTL });
    const refresh = await repo.issueRefreshToken(actorType, actorId, meta);
    return { accessToken, refreshToken: refresh.rawToken, expiresIn: env.auth.accessTtlSeconds };
  }

  private signMfaPendingToken(claims: MfaPendingTokenClaims): string {
    return this.jwt.sign(claims, { secret: env.auth.jwtSecret, expiresIn: MFA_PENDING_TTL });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const claims = this.jwt.verify<AccessTokenClaims & { tokenType: string }>(token, { secret: env.auth.jwtSecret });
    if (claims.tokenType !== 'access') throw new Error('not an access token');
    return claims as AccessTokenClaims;
  }

  verifyMfaPendingToken(token: string, expected: MfaPendingTokenClaims['tokenType']): MfaPendingTokenClaims {
    const claims = this.jwt.verify<MfaPendingTokenClaims & { tokenType: string }>(token, {
      secret: env.auth.jwtSecret,
    });
    if (claims.tokenType !== expected) throw new Error(`expected a ${expected} token`);
    return claims as MfaPendingTokenClaims;
  }

  // ---- broker (AUTH-001/002) ----

  async registerBroker(input: { email: string; password: string; firstName: string; lastName: string }) {
    return repo.registerBroker(input);
  }

  async loginBroker(email: string, password: string, meta: RequestMeta): Promise<TokenPair | null> {
    const result = await repo.authenticateBroker(email, password);
    if (!result) return null;
    return this.issueTokenPair('broker', result.id, {}, meta);
  }

  // ---- platform admin (AUTH-002) ----

  async loginPlatformAdmin(email: string, password: string, meta: RequestMeta): Promise<TokenPair | null> {
    const result = await repo.authenticatePlatformAdmin(email, password);
    if (!result) return null;
    return this.issueTokenPair('platform_admin', result.id, {}, meta);
  }

  // ---- client user login + mandatory MFA (AUTH-002, AUTH-006) ----

  /**
   * Never returns a full token pair — AUTH-006 "mandatory" is enforced structurally:
   * a client_user cannot reach issueTokenPair without first passing through
   * verifyMfaLogin (already enrolled) or completeMfaEnrolment (first-time).
   */
  async loginClientUser(
    email: string,
    password: string,
  ): Promise<{ pendingToken: string; tokenType: MfaPendingTokenClaims['tokenType'] } | null> {
    const result = await repo.authenticateClientUser(email, password);
    if (!result) return null;
    const tokenType = result.mfaEnrolled ? 'mfa_pending' : 'mfa_enrolment_pending';
    return { pendingToken: this.signMfaPendingToken({ tokenType, clientUserId: result.id }), tokenType };
  }

  async beginMfaEnrolment(clientUserId: string): Promise<{ otpauthUri: string; secret: string; backupCodes: string[] }> {
    const secret = authenticator.generateSecret();
    const backupCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex'));
    await repo.saveMfaEnrollment(clientUserId, secret, backupCodes);
    const otpauthUri = authenticator.keyuri(clientUserId, 'brok3r', secret);
    return { otpauthUri, secret, backupCodes };
  }

  async confirmMfaEnrolment(clientUserId: string, code: string, meta: RequestMeta): Promise<TokenPair> {
    const credential = await repo.getMfaCredential(clientUserId);
    if (!credential || !authenticator.check(code, credential.secret)) {
      await repo.recordMfaVerification(clientUserId, false);
      throw new Error('invalid TOTP code');
    }
    await repo.confirmMfaEnrollment(clientUserId);
    await repo.recordMfaVerification(clientUserId, true);
    const clientUser = await repo.authenticateClientUserById(clientUserId);
    return this.issueTokenPair(
      'client_user',
      clientUserId,
      { clientOrganisationId: clientUser.clientOrganisationId, role: clientUser.role },
      meta,
    );
  }

  async verifyMfaLogin(
    clientUserId: string,
    input: { code?: string; backupCode?: string },
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const credential = await repo.getMfaCredential(clientUserId);
    if (!credential || !credential.enrolled) throw new Error('MFA is not enrolled for this account');

    const ok = input.backupCode
      ? await repo.consumeBackupCode(clientUserId, input.backupCode)
      : !!input.code && authenticator.check(input.code, credential.secret);

    await repo.recordMfaVerification(clientUserId, ok);
    if (!ok) throw new Error('invalid MFA code');

    const clientUser = await repo.authenticateClientUserById(clientUserId);
    return this.issueTokenPair(
      'client_user',
      clientUserId,
      { clientOrganisationId: clientUser.clientOrganisationId, role: clientUser.role },
      meta,
    );
  }

  // ---- session management (AUTH-002/003) ----

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<TokenPair | null> {
    const rotated = await repo.rotateRefreshToken(rawRefreshToken, meta);
    if (!rotated) return null;
    let extra: { clientOrganisationId?: string; role?: repo.ClientUserRole } = {};
    if (rotated.actorType === 'client_user') {
      const clientUser = await repo.authenticateClientUserById(rotated.actorId);
      extra = { clientOrganisationId: clientUser.clientOrganisationId, role: clientUser.role };
    }
    const claims: AccessTokenClaims = { tokenType: 'access', actorType: rotated.actorType, actorId: rotated.actorId, ...extra };
    const accessToken = this.jwt.sign(claims, { secret: env.auth.jwtSecret, expiresIn: ACCESS_TTL });
    return { accessToken, refreshToken: rotated.rawToken, expiresIn: env.auth.accessTtlSeconds };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await repo.revokeRefreshToken(rawRefreshToken);
  }

  // ---- password change/reset (AUTH-004/005) ----

  async changePassword(
    ctx: AuthorizationContext,
    actorType: repo.PasswordActorType,
    actorId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    return repo.changePassword(ctx, actorType, actorId, currentPassword, newPassword);
  }

  async requestPasswordReset(actorType: repo.PasswordActorType, email: string): Promise<string | null> {
    const result = await repo.createPasswordResetToken(actorType, email);
    return result?.rawToken ?? null;
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    return repo.redeemPasswordResetToken(rawToken, newPassword);
  }
}
