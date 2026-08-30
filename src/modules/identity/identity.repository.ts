import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { withAuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';

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

export type ClientOrganisationType = 'lender' | 'aggregator' | 'association';

/**
 * W7 / PLT-001, PLT-004: administrative client-organisation onboarding. Runs as the
 * 'system' actor — there is no client-organisation self-registration in Release 1
 * (Section 6.7: "Administrative, performed by Thriski operations").
 */
export async function createClientOrganisation(input: {
  type: ClientOrganisationType;
  name: string;
}): Promise<{ id: string }> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO client_organisations (type, name) VALUES ($1, $2) RETURNING id`,
      [input.type, input.name],
    );
    const id = rows[0].id as string;
    await recordAuditEvent(client, {
      actorType: 'system',
      action: 'client_organisation.created',
      subjectType: 'client_organisation',
      subjectId: id,
      detail: { type: input.type, name: input.name },
    });
    return { id };
  });
}

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
 * AUTH-002: sign in. Returns just enough to construct an AuthorizationContext for
 * subsequent requests (e.g. in a session or a signed JWT) — this function itself runs
 * as 'system' because, by definition, we don't yet know who the caller is when
 * authenticating them.
 */
export async function authenticateBroker(
  email: string,
  password: string,
): Promise<{ id: string } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, password_hash FROM broker_profiles WHERE email = $1`,
      [email.toLowerCase()],
    );
    if (rows.length === 0) return null;
    if (!verifyPassword(password, rows[0].password_hash)) return null;
    return { id: rows[0].id as string };
  });
}

export async function createClientUser(input: {
  clientOrganisationId: string;
  email: string;
  password: string;
  role:
    | 'reviewer'
    | 'relationship_manager'
    | 'senior_approver'
    | 'compliance_officer'
    | 'client_admin';
}): Promise<{ id: string }> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO client_users (client_organisation_id, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.clientOrganisationId, input.email.toLowerCase(), hashPassword(input.password), input.role],
    );
    return { id: rows[0].id as string };
  });
}
