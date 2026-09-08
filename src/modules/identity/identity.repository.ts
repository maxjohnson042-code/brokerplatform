import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { env } from '../../config/env';

// scrypt rather than adding a bcrypt/argon2 dependency to the scaffold — swap for
// argon2id before this goes anywhere near production. Not a design decision, just a
// "don't add a native dependency to a repo nobody's reviewed yet" one.
function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  const derived = scryptSync(plain, Buffer.from(saltHex, 'hex'), 64);
  return timingSafeEqual(derived, Buffer.from(hashHex, 'hex'));
}

function actorIdOf(ctx: AuthorizationContext): string | undefined {
  return 'actorId' in ctx ? ctx.actorId : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashBackupCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// AES-256-GCM for client_user_mfa_secrets.secret_encrypted — same "don't add a KMS
// dependency to an unreviewed scaffold" reasoning as scrypt above. Swap for a real
// KMS-backed encryption before production (see migration 0010's comment).
function mfaEncryptionKey(): Buffer {
  return Buffer.from(env.auth.mfaEncryptionKey, 'hex');
}

function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mfaEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
}

function decryptSecret(encrypted: string): string {
  const [ivHex, ciphertextHex, authTagHex] = encrypted.split(':');
  const decipher = createDecipheriv('aes-256-gcm', mfaEncryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}

export class ClientUserEmailTakenError extends Error {
  constructor(email: string) {
    super(`client user email already in use: ${email}`);
    this.name = 'ClientUserEmailTakenError';
  }
}
export class ClientUserNotFoundError extends Error {
  constructor(id: string) {
    super(`client user not found: ${id}`);
    this.name = 'ClientUserNotFoundError';
  }
}
export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super('current password is incorrect');
    this.name = 'InvalidCurrentPasswordError';
  }
}
export class InvalidResetTokenError extends Error {
  constructor() {
    super('reset token is invalid, expired or already used');
    this.name = 'InvalidResetTokenError';
  }
}
export class RefreshTokenReuseDetectedError extends Error {
  constructor() {
    super('refresh token reuse detected — all sessions for this actor have been revoked');
    this.name = 'RefreshTokenReuseDetectedError';
  }
}

export type ClientOrganisationType = 'lender' | 'aggregator' | 'association';
export type ClientUserRole =
  | 'reviewer'
  | 'relationship_manager'
  | 'senior_approver'
  | 'compliance_officer'
  | 'client_admin';
// The three actor types that own a password (and therefore change-password/reset
// flows) — 'system' is intentionally excluded, it never authenticates via a password.
export type PasswordActorType = 'broker' | 'client_user' | 'platform_admin';
export type SessionActorType = PasswordActorType;

const PASSWORD_TABLE: Record<PasswordActorType, string> = {
  broker: 'broker_profiles',
  client_user: 'client_users',
  platform_admin: 'platform_administrators',
};

// ---------------------------------------------------------------------------
// Client organisations (W7)
// ---------------------------------------------------------------------------

/**
 * W7 / PLT-001, PLT-004: administrative client-organisation onboarding. `ctx` must be
 * 'system' (bootstrap scripts) or 'platform_admin' (the W7 admin tool) — migration
 * 0013's client_organisations_write policy enforces this at the database layer too.
 */
export async function createClientOrganisation(
  ctx: AuthorizationContext,
  input: { type: ClientOrganisationType; name: string },
): Promise<{ id: string }> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO client_organisations (type, name) VALUES ($1, $2) RETURNING id`,
      [input.type, input.name],
    );
    const id = rows[0].id as string;
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'client_organisation.created',
      subjectType: 'client_organisation',
      subjectId: id,
      detail: { type: input.type, name: input.name },
    });
    return { id };
  });
}

/** W7 entity verification step — kept separate from the coarse `status` column. */
export async function verifyClientOrganisation(
  ctx: AuthorizationContext,
  clientOrganisationId: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    await client.query(
      `UPDATE client_organisations SET verified_at = now(), updated_at = now() WHERE id = $1`,
      [clientOrganisationId],
    );
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'client_organisation.verified',
      subjectType: 'client_organisation',
      subjectId: clientOrganisationId,
    });
  });
}

export type ClientOrganisationSettingKey = 'productScopes' | 'branding';

/**
 * W7 product scopes / branding. Written into the `settings` jsonb column rather than
 * dedicated columns (Section 20.1: jsonb for config without schema churn). Ruleset
 * assignment used to live here too as a placeholder ('rulesetId', a bare string with
 * no foreign key) — Epic 9 replaced it with real ruleset_versions rows and the
 * rulesets module's own resolve()/createDraft()/publish(), so the placeholder was
 * removed rather than kept alongside the real mechanism.
 */
export async function updateClientOrganisationSetting(
  ctx: AuthorizationContext,
  clientOrganisationId: string,
  key: ClientOrganisationSettingKey,
  value: unknown,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    await client.query(
      `UPDATE client_organisations
       SET settings = jsonb_set(settings, $2, $3::jsonb, true), updated_at = now()
       WHERE id = $1`,
      [clientOrganisationId, `{${key}}`, JSON.stringify(value)],
    );
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: `client_organisation.${key}_updated`,
      subjectType: 'client_organisation',
      subjectId: clientOrganisationId,
      detail: { [key]: value },
    });
  });
}

// ---------------------------------------------------------------------------
// Client users (AUTH-006, AUTH-008)
// ---------------------------------------------------------------------------

/**
 * AUTH-008 provisioning. `clientOrganisationId` must come from the caller's own
 * AuthorizationContext (a client_admin provisioning into their own org) or from the W7
 * tool (platform_admin/system provisioning the org's first client_admin) — never from
 * an unauthenticated request body. Migration 0013's client_users_insert policy is the
 * database-layer backstop for the same rule.
 */
export async function createClientUser(
  ctx: AuthorizationContext,
  input: { clientOrganisationId: string; email: string; password: string; role: ClientUserRole },
): Promise<{ id: string }> {
  return withAuthorizationContext(ctx, async (client) => {
    let rows: Array<{ id: string }>;
    try {
      ({ rows } = await client.query(
        `INSERT INTO client_users (client_organisation_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.clientOrganisationId, input.email.toLowerCase(), hashPassword(input.password), input.role],
      ));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ClientUserEmailTakenError(input.email);
      throw err;
    }
    const id = rows[0].id;
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'client_user.provisioned',
      subjectType: 'client_user',
      subjectId: id,
      clientOrganisationId: input.clientOrganisationId,
      detail: { email: input.email.toLowerCase(), role: input.role },
    });
    return { id };
  });
}

/** AUTH-008 listing — `clientOrganisationId` is explicit (not inferred from RLS alone), per Section 20.2. */
export async function listClientUsers(
  ctx: AuthorizationContext,
  clientOrganisationId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, role, mfa_enrolled, is_active, created_at
       FROM client_users WHERE client_organisation_id = $1 ORDER BY created_at`,
      [clientOrganisationId],
    );
    return rows;
  });
}

/** AUTH-008 role assignment. */
export async function updateClientUserRole(
  ctx: AuthorizationContext,
  clientOrganisationId: string,
  clientUserId: string,
  role: ClientUserRole,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE client_users SET role = $1, updated_at = now()
       WHERE id = $2 AND client_organisation_id = $3`,
      [role, clientUserId, clientOrganisationId],
    );
    if (rowCount === 0) throw new ClientUserNotFoundError(clientUserId);
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'client_user.role_changed',
      subjectType: 'client_user',
      subjectId: clientUserId,
      clientOrganisationId,
      detail: { role },
    });
  });
}

/**
 * AUTH-008 deactivation/reactivation. Deactivating also revokes every outstanding
 * refresh token for that user in the same transaction, so it takes effect on their
 * next /refresh call — their access token's short TTL bounds the remaining staleness
 * window rather than making it unbounded.
 */
export async function setClientUserActive(
  ctx: AuthorizationContext,
  clientOrganisationId: string,
  clientUserId: string,
  isActive: boolean,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE client_users SET is_active = $1, updated_at = now()
       WHERE id = $2 AND client_organisation_id = $3`,
      [isActive, clientUserId, clientOrganisationId],
    );
    if (rowCount === 0) throw new ClientUserNotFoundError(clientUserId);
    if (!isActive) {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE actor_type = 'client_user' AND actor_id = $1 AND revoked_at IS NULL`,
        [clientUserId],
      );
    }
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: isActive ? 'client_user.reactivated' : 'client_user.deactivated',
      subjectType: 'client_user',
      subjectId: clientUserId,
      clientOrganisationId,
    });
  });
}

// ---------------------------------------------------------------------------
// Broker registration and sign-in (AUTH-001, AUTH-002)
// ---------------------------------------------------------------------------

/**
 * AUTH-001: broker self-registration. Broker profile and login credential are the
 * same table for Release 1 (see migration 0003's comment) — this only touches the
 * identity-relevant columns; profile fields are the brokers module's concern (Epic 3).
 */
export async function registerBroker(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<{ id: string }> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO broker_profiles (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.email.toLowerCase(), hashPassword(input.password), input.firstName, input.lastName],
    );
    const id = rows[0].id as string;
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: id,
      action: 'broker_profile.registered',
      subjectType: 'broker_profile',
      subjectId: id,
    });
    return { id };
  });
}

/**
 * AUTH-002: sign in. Runs as 'system' because we don't know who the caller is until
 * this returns. No audit row is written when the email doesn't exist at all — there is
 * no subject to attach it to (audit_log.subject_id is NOT NULL) — but both a wrong
 * password and a success against a real account are audited.
 */
export async function authenticateBroker(email: string, password: string): Promise<{ id: string } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, password_hash FROM broker_profiles WHERE email = $1`,
      [email.toLowerCase()],
    );
    if (rows.length === 0) return null;
    const id = rows[0].id as string;
    const ok = verifyPassword(password, rows[0].password_hash);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: id,
      action: ok ? 'broker.login_succeeded' : 'broker.login_failed',
      subjectType: 'broker_profile',
      subjectId: id,
    });
    return ok ? { id } : null;
  });
}

// ---------------------------------------------------------------------------
// Client user and platform admin sign-in (AUTH-002)
// ---------------------------------------------------------------------------

export async function authenticateClientUser(
  email: string,
  password: string,
): Promise<{ id: string; clientOrganisationId: string; role: ClientUserRole; mfaEnrolled: boolean } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, client_organisation_id, role, password_hash, mfa_enrolled, is_active
       FROM client_users WHERE email = $1`,
      [email.toLowerCase()],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const id = row.id as string;
    const ok = (row.is_active as boolean) && verifyPassword(password, row.password_hash as string);
    await recordAuditEvent(client, {
      actorType: 'client_user',
      actorId: id,
      action: ok ? 'client_user.login_succeeded' : 'client_user.login_failed',
      subjectType: 'client_user',
      subjectId: id,
      clientOrganisationId: row.client_organisation_id as string,
    });
    if (!ok) return null;
    return {
      id,
      clientOrganisationId: row.client_organisation_id as string,
      role: row.role as ClientUserRole,
      mfaEnrolled: row.mfa_enrolled as boolean,
    };
  });
}

/**
 * No password check — used to re-derive JWT claims (clientOrganisationId, role) for an
 * already-authenticated actor: after MFA verification succeeds, and on /refresh, where
 * the caller has already proven identity via the MFA-pending token or the refresh
 * token itself and just needs current claim values (e.g. a role change since the last
 * token was issued).
 */
export async function authenticateClientUserById(
  clientUserId: string,
): Promise<{ id: string; clientOrganisationId: string; role: ClientUserRole }> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, client_organisation_id, role FROM client_users WHERE id = $1`,
      [clientUserId],
    );
    if (rows.length === 0) throw new ClientUserNotFoundError(clientUserId);
    return {
      id: rows[0].id as string,
      clientOrganisationId: rows[0].client_organisation_id as string,
      role: rows[0].role as ClientUserRole,
    };
  });
}

export async function authenticatePlatformAdmin(email: string, password: string): Promise<{ id: string } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, password_hash, is_active FROM platform_administrators WHERE email = $1`,
      [email.toLowerCase()],
    );
    if (rows.length === 0) return null;
    const id = rows[0].id as string;
    const ok = (rows[0].is_active as boolean) && verifyPassword(password, rows[0].password_hash as string);
    await recordAuditEvent(client, {
      actorType: 'platform_admin',
      actorId: id,
      action: ok ? 'platform_admin.login_succeeded' : 'platform_admin.login_failed',
      subjectType: 'platform_administrator',
      subjectId: id,
    });
    return ok ? { id } : null;
  });
}

// ---------------------------------------------------------------------------
// Password change and reset (AUTH-004, AUTH-005) — shared across all three actor types
// ---------------------------------------------------------------------------

/** AUTH-004. Revokes every outstanding refresh token for the actor — a password change is a "sign out everywhere else" event. */
export async function changePassword(
  ctx: AuthorizationContext,
  actorType: PasswordActorType,
  actorId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const table = PASSWORD_TABLE[actorType];
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT password_hash FROM ${table} WHERE id = $1`, [actorId]);
    if (rows.length === 0 || !verifyPassword(currentPassword, rows[0].password_hash)) {
      throw new InvalidCurrentPasswordError();
    }
    await client.query(`UPDATE ${table} SET password_hash = $1 WHERE id = $2`, [hashPassword(newPassword), actorId]);
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE actor_type = $1 AND actor_id = $2 AND revoked_at IS NULL`,
      [actorType, actorId],
    );
    await recordAuditEvent(client, {
      actorType,
      actorId,
      action: `${actorType}.password_changed`,
      subjectType: actorType,
      subjectId: actorId,
    });
  });
}

/**
 * AUTH-005, step one. Always looks like it succeeded to the caller (see the
 * controller) regardless of whether `email` matches an account — this function is the
 * one place that actually knows, and only creates a token/returns non-null when it does.
 */
export async function createPasswordResetToken(
  actorType: PasswordActorType,
  email: string,
): Promise<{ actorId: string; rawToken: string } | null> {
  const table = PASSWORD_TABLE[actorType];
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id FROM ${table} WHERE email = $1`, [email.toLowerCase()]);
    if (rows.length === 0) return null;
    const actorId = rows[0].id as string;
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await client.query(
      `INSERT INTO password_reset_tokens (actor_type, actor_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [actorType, actorId, hashOpaqueToken(rawToken), expiresAt],
    );
    await recordAuditEvent(client, {
      actorType,
      actorId,
      action: `${actorType}.password_reset_requested`,
      subjectType: actorType,
      subjectId: actorId,
    });
    return { actorId, rawToken };
  });
}

/** AUTH-005, step two. Single-use: used_at is set in the same transaction as the password UPDATE. */
export async function redeemPasswordResetToken(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashOpaqueToken(rawToken);
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, actor_type, actor_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    if (rows.length === 0) throw new InvalidResetTokenError();
    const tokenId = rows[0].id as string;
    const actorType = rows[0].actor_type as PasswordActorType;
    const actorId = rows[0].actor_id as string;
    const table = PASSWORD_TABLE[actorType];

    await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [tokenId]);
    await client.query(`UPDATE ${table} SET password_hash = $1 WHERE id = $2`, [hashPassword(newPassword), actorId]);
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE actor_type = $1 AND actor_id = $2 AND revoked_at IS NULL`,
      [actorType, actorId],
    );
    await recordAuditEvent(client, {
      actorType,
      actorId,
      action: `${actorType}.password_reset_completed`,
      subjectType: actorType,
      subjectId: actorId,
    });
  });
}

// ---------------------------------------------------------------------------
// MFA (AUTH-006) — TOTP secret generation itself lives in identity.service.ts
// (it's not a database concern); this is the storage boundary for it.
// ---------------------------------------------------------------------------

/** Starts (or restarts) enrolment: stores the secret + backup codes, leaves enrolled_at NULL until confirmed. */
export async function saveMfaEnrollment(
  clientUserId: string,
  secretPlain: string,
  backupCodesPlain: string[],
): Promise<void> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    await client.query(
      `INSERT INTO client_user_mfa_secrets (client_user_id, secret_encrypted, backup_codes_hash, enrolled_at)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (client_user_id) DO UPDATE SET
         secret_encrypted = EXCLUDED.secret_encrypted,
         backup_codes_hash = EXCLUDED.backup_codes_hash,
         enrolled_at = NULL`,
      [clientUserId, encryptSecret(secretPlain), backupCodesPlain.map(hashBackupCode)],
    );
  });
}

export async function getMfaCredential(
  clientUserId: string,
): Promise<{ secret: string; backupCodesHash: string[]; enrolled: boolean } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT secret_encrypted, backup_codes_hash, enrolled_at
       FROM client_user_mfa_secrets WHERE client_user_id = $1`,
      [clientUserId],
    );
    if (rows.length === 0) return null;
    return {
      secret: decryptSecret(rows[0].secret_encrypted as string),
      backupCodesHash: rows[0].backup_codes_hash as string[],
      enrolled: rows[0].enrolled_at !== null,
    };
  });
}

export async function confirmMfaEnrollment(clientUserId: string): Promise<void> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    await client.query(`UPDATE client_user_mfa_secrets SET enrolled_at = now() WHERE client_user_id = $1`, [
      clientUserId,
    ]);
    await client.query(`UPDATE client_users SET mfa_enrolled = true, updated_at = now() WHERE id = $1`, [
      clientUserId,
    ]);
    await recordAuditEvent(client, {
      actorType: 'client_user',
      actorId: clientUserId,
      action: 'client_user.mfa_enrolled',
      subjectType: 'client_user',
      subjectId: clientUserId,
    });
  });
}

/** Consumes one backup code, atomically — returns false if it wasn't present (already used, or never issued). */
export async function consumeBackupCode(clientUserId: string, code: string): Promise<boolean> {
  const codeHash = hashBackupCode(code);
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `UPDATE client_user_mfa_secrets
       SET backup_codes_hash = array_remove(backup_codes_hash, $2)
       WHERE client_user_id = $1 AND $2 = ANY(backup_codes_hash)
       RETURNING client_user_id`,
      [clientUserId, codeHash],
    );
    return rows.length > 0;
  });
}

export async function recordMfaVerification(clientUserId: string, success: boolean): Promise<void> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    await recordAuditEvent(client, {
      actorType: 'client_user',
      actorId: clientUserId,
      action: success ? 'client_user.mfa_verified' : 'client_user.mfa_verification_failed',
      subjectType: 'client_user',
      subjectId: clientUserId,
    });
  });
}

// ---------------------------------------------------------------------------
// Refresh tokens (AUTH-002/003 session management)
// ---------------------------------------------------------------------------

export type IssuedRefreshToken = { rawToken: string; expiresAt: Date };
type RefreshTokenMeta = { userAgent?: string; ipAddress?: string };

export async function issueRefreshToken(
  actorType: SessionActorType,
  actorId: string,
  meta: RefreshTokenMeta,
): Promise<IssuedRefreshToken> {
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.auth.refreshTtlDays * 24 * 60 * 60 * 1000);
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    await client.query(
      `INSERT INTO refresh_tokens (actor_type, actor_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorType, actorId, hashOpaqueToken(rawToken), expiresAt, meta.userAgent ?? null, meta.ipAddress ?? null],
    );
    return { rawToken, expiresAt };
  });
}

/**
 * Rotates a refresh token on use. A *revoked* token being presented again is treated
 * as theft — see identity.repository.ts's file comment on refresh_tokens and the
 * plan's reuse-detection design: every active session for that actor is killed and the
 * caller gets RefreshTokenReuseDetectedError, not just a plain "invalid token".
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: RefreshTokenMeta,
): Promise<{ actorType: SessionActorType; actorId: string; rawToken: string; expiresAt: Date } | null> {
  const tokenHash = hashOpaqueToken(rawToken);

  // The reuse-detection branch below must COMMIT its revocation, not roll it back —
  // so it can't throw from inside withAuthorizationContext's callback (a throw there
  // triggers ROLLBACK, which would undo the very "kill every session" response reuse
  // detection exists to perform). Instead the callback returns a `reused` outcome, and
  // this function throws only after the transaction has already committed.
  const outcome = await withAuthorizationContext(
    { actorType: 'system' },
    async (
      client,
    ): Promise<
      | { reused: true }
      | { reused: false; rotated: null }
      | { reused: false; rotated: { actorType: SessionActorType; actorId: string; rawToken: string; expiresAt: Date } }
    > => {
      const { rows } = await client.query(
        `SELECT id, actor_type, actor_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      if (rows.length === 0) return { reused: false, rotated: null };
      const row = rows[0] as {
        id: string;
        actor_type: SessionActorType;
        actor_id: string;
        expires_at: Date;
        revoked_at: Date | null;
      };

      if (row.revoked_at !== null) {
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE actor_type = $1 AND actor_id = $2 AND revoked_at IS NULL`,
          [row.actor_type, row.actor_id],
        );
        await recordAuditEvent(client, {
          actorType: row.actor_type,
          actorId: row.actor_id,
          action: 'session.refresh_token_reuse_detected',
          subjectType: row.actor_type,
          subjectId: row.actor_id,
        });
        return { reused: true };
      }
      if (row.expires_at.getTime() < Date.now()) return { reused: false, rotated: null };

      const newRawToken = randomBytes(32).toString('base64url');
      const newExpiresAt = new Date(Date.now() + env.auth.refreshTtlDays * 24 * 60 * 60 * 1000);
      const { rows: inserted } = await client.query(
        `INSERT INTO refresh_tokens (actor_type, actor_id, token_hash, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [row.actor_type, row.actor_id, hashOpaqueToken(newRawToken), newExpiresAt, meta.userAgent ?? null, meta.ipAddress ?? null],
      );
      await client.query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2`, [
        inserted[0].id,
        row.id,
      ]);

      return {
        reused: false,
        rotated: { actorType: row.actor_type, actorId: row.actor_id, rawToken: newRawToken, expiresAt: newExpiresAt },
      };
    },
  );

  if (outcome.reused) throw new RefreshTokenReuseDetectedError();
  return outcome.rotated;
}

/** AUTH-003 sign out: revokes exactly the presented refresh token. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashOpaqueToken(rawToken);
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
      tokenHash,
    ]);
  });
}
