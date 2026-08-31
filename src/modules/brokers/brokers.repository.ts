import type { PoolClient } from 'pg';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';

export class BrokerProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`broker profile not found: ${id}`);
    this.name = 'BrokerProfileNotFoundError';
  }
}
export class BrokerProfileNotEditableError extends Error {
  constructor(public readonly status: string) {
    super(`broker profile cannot be edited while status is '${status}'`);
    this.name = 'BrokerProfileNotEditableError';
  }
}
export type OutstandingItem = { field: string; reason: string };
export class BrokerProfileIncompleteError extends Error {
  constructor(public readonly items: OutstandingItem[]) {
    super('broker profile has outstanding items and cannot be submitted');
    this.name = 'BrokerProfileIncompleteError';
  }
}
export class AssociationMembershipNotFoundError extends Error {
  constructor(id: string) {
    super(`association membership not found: ${id}`);
    this.name = 'AssociationMembershipNotFoundError';
  }
}

function assertEditable(status: string): void {
  if (status !== 'draft' && status !== 'attention_required') throw new BrokerProfileNotEditableError(status);
}

/**
 * PRF-001 / CLI-002: reads broker_profiles through the SAME AuthorizationContext
 * mechanism a client_user or the broker themself would use — this function applies no
 * filtering of its own. If the row isn't visible, RLS (migration 0007) returns zero
 * rows, and that's the correct answer whether the caller is a lender with no
 * relationship or a broker asking for someone else's profile. This is deliberate:
 * scripts/demo-tenancy.ts calls this exact function as three different actors to
 * prove the boundary holds, and Epic 3's own /brokers/me GET reuses it unchanged.
 *
 * Selects the full profile (personal + Epic-3 licensing fields) rather than a subset —
 * Section 2.4's "a linked client sees the full result, not a summary" applies here the
 * same way it does to evidence/check_result.
 */
export async function getBrokerProfile(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<Record<string, unknown> | null> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, first_name, last_name, other_names, date_of_birth, gender,
              phone_number, mobile_number, address, postal_address, right_to_work_status,
              experience_years, licence_type_held, credit_licence_number,
              credit_representative_number, licensing_entity_name, licensing_entity_number,
              status, attested_terms_at, created_at, updated_at
       FROM broker_profiles WHERE id = $1`,
      [brokerProfileId],
    );
    return rows[0] ?? null;
  });
}

// camelCase DTO key -> snake_case column, the only columns updateBrokerProfile is
// allowed to touch — a fixed allow-list rather than trusting request-body keys as
// column names directly.
const PROFILE_UPDATABLE_FIELDS: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  otherNames: 'other_names',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  phoneNumber: 'phone_number',
  mobileNumber: 'mobile_number',
  address: 'address',
  postalAddress: 'postal_address',
  rightToWorkStatus: 'right_to_work_status',
  experienceYears: 'experience_years',
  licenceTypeHeld: 'licence_type_held',
  creditLicenceNumber: 'credit_licence_number',
  creditRepresentativeNumber: 'credit_representative_number',
  licensingEntityName: 'licensing_entity_name',
  licensingEntityNumber: 'licensing_entity_number',
};

function serializeValue(key: string, value: unknown): unknown {
  return key === 'address' || key === 'postalAddress' ? JSON.stringify(value) : value;
}

/**
 * ONB-003/005/012, draft save (ONB-008). Partial update — only keys present in `patch`
 * are touched. Rejects with BrokerProfileNotEditableError once the profile is past
 * draft/attention_required: editing after submission means editing data a reviewer may
 * already be acting on.
 */
export async function updateBrokerProfile(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([key]) => key in PROFILE_UPDATABLE_FIELDS);
  if (entries.length === 0) return;

  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_profiles WHERE id = $1`, [brokerProfileId]);
    if (rows.length === 0) throw new BrokerProfileNotFoundError(brokerProfileId);
    assertEditable(rows[0].status as string);

    const params: unknown[] = [brokerProfileId];
    const setClauses = entries.map(([key, value]) => {
      params.push(serializeValue(key, value));
      return `${PROFILE_UPDATABLE_FIELDS[key]} = $${params.length}`;
    });

    await client.query(
      `UPDATE broker_profiles SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1`,
      params,
    );
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'broker_profile.updated',
      subjectType: 'broker_profile',
      subjectId: brokerProfileId,
      detail: { fields: entries.map(([key]) => key) },
    });
  });
}

/** ONB-002: attestation gates submission (see submitProfile's outstanding-items check). */
export async function attestTerms(ctx: AuthorizationContext, brokerProfileId: string): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    await client.query(
      `UPDATE broker_profiles SET attested_terms_at = now(), updated_at = now() WHERE id = $1`,
      [brokerProfileId],
    );
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'broker_profile.terms_attested',
      subjectType: 'broker_profile',
      subjectId: brokerProfileId,
    });
  });
}

type ProfileFieldsForCompleteness = {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  phone_number: string | null;
  mobile_number: string | null;
  address: { line1?: string; city?: string; postcode?: string; state?: string } | null;
  experience_years: number | null;
  licence_type_held: string | null;
  credit_licence_number: string | null;
  credit_representative_number: string | null;
  licensing_entity_name: string | null;
  licensing_entity_number: string | null;
  attested_terms_at: string | null;
};

/**
 * ONB-009's actual rule set, factored out so both getOutstandingItems (a plain read)
 * and submitProfile (which must gate atomically, in the same transaction as the status
 * change) call the identical logic — one source of truth for "what's missing," not two
 * implementations that can drift apart.
 */
function computeOutstandingItems(p: ProfileFieldsForCompleteness, membershipCount: number): OutstandingItem[] {
  const items: OutstandingItem[] = [];
  const require = (value: unknown, field: string, reason: string) => {
    if (value === null || value === undefined || value === '') items.push({ field, reason });
  };

  require(p.first_name, 'firstName', 'First name is required.');
  require(p.last_name, 'lastName', 'Last name is required.');
  require(p.date_of_birth, 'dateOfBirth', 'Date of birth is required.');
  require(p.phone_number, 'phoneNumber', 'Phone number is required.');
  require(p.mobile_number, 'mobileNumber', 'Mobile number is required.');
  require(p.experience_years, 'experienceYears', 'Years of experience is required.');

  const a = p.address;
  if (!a || !a.line1 || !a.city || !a.postcode || !a.state) {
    items.push({ field: 'address', reason: 'Residential address (line 1, city, postcode, state) is required.' });
  }

  require(p.licence_type_held, 'licenceTypeHeld', 'Licence type held is required.');
  if (p.licence_type_held === 'own_credit_licence') {
    require(
      p.credit_licence_number,
      'creditLicenceNumber',
      'Credit licence number is required when you hold your own credit licence.',
    );
  } else if (p.licence_type_held === 'credit_representative') {
    require(p.credit_representative_number, 'creditRepresentativeNumber', 'Credit representative number is required.');
    require(p.licensing_entity_name, 'licensingEntityName', 'The name of the entity holding your licence is required.');
    require(
      p.licensing_entity_number,
      'licensingEntityNumber',
      'The licence number of the entity holding your licence is required.',
    );
  }

  if (membershipCount === 0) {
    items.push({ field: 'associationMemberships', reason: 'At least one association membership is required.' });
  }

  require(p.attested_terms_at, 'attestedTermsAt', 'You must attest to the privacy policy and terms before submitting.');

  return items;
}

async function fetchCompletenessInputs(
  client: PoolClient,
  brokerProfileId: string,
): Promise<{ profile: ProfileFieldsForCompleteness; membershipCount: number }> {
  const { rows } = await client.query(
    `SELECT first_name, last_name, date_of_birth, phone_number, mobile_number, address,
            experience_years, licence_type_held, credit_licence_number,
            credit_representative_number, licensing_entity_name, licensing_entity_number,
            attested_terms_at
     FROM broker_profiles WHERE id = $1`,
    [brokerProfileId],
  );
  if (rows.length === 0) throw new BrokerProfileNotFoundError(brokerProfileId);

  const { rows: memberships } = await client.query(
    `SELECT id FROM association_memberships WHERE broker_profile_id = $1`,
    [brokerProfileId],
  );

  return { profile: rows[0] as ProfileFieldsForCompleteness, membershipCount: memberships.length };
}

/** ONB-009: returns only the items that ARE missing, each with why. */
export async function getOutstandingItems(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<OutstandingItem[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { profile, membershipCount } = await fetchCompletenessInputs(client, brokerProfileId);
    return computeOutstandingItems(profile, membershipCount);
  });
}

/**
 * ONB-008/009: draft/attention_required -> submitted. Reuses computeOutstandingItems
 * as the gate in the SAME transaction as the status change — throws
 * BrokerProfileIncompleteError (carrying the items) rather than silently no-op'ing so
 * the controller can return exactly what's still missing.
 */
export async function submitProfile(ctx: AuthorizationContext, brokerProfileId: string): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_profiles WHERE id = $1`, [brokerProfileId]);
    if (rows.length === 0) throw new BrokerProfileNotFoundError(brokerProfileId);
    assertEditable(rows[0].status as string);

    const { profile, membershipCount } = await fetchCompletenessInputs(client, brokerProfileId);
    const items = computeOutstandingItems(profile, membershipCount);
    if (items.length > 0) throw new BrokerProfileIncompleteError(items);

    await client.query(`UPDATE broker_profiles SET status = 'submitted', updated_at = now() WHERE id = $1`, [
      brokerProfileId,
    ]);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'broker_profile.submitted',
      subjectType: 'broker_profile',
      subjectId: brokerProfileId,
    });
  });
}

// ---------------------------------------------------------------------------
// Association memberships (ONB-006, ONB-008)
// ---------------------------------------------------------------------------

export async function createAssociationMembership(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  input: { associationName: string; membershipNumber: string },
): Promise<{ id: string }> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows: statusRows } = await client.query(`SELECT status FROM broker_profiles WHERE id = $1`, [
      brokerProfileId,
    ]);
    if (statusRows.length === 0) throw new BrokerProfileNotFoundError(brokerProfileId);
    assertEditable(statusRows[0].status as string);

    const { rows } = await client.query(
      `INSERT INTO association_memberships (broker_profile_id, association_name, membership_number)
       VALUES ($1, $2, $3) RETURNING id`,
      [brokerProfileId, input.associationName, input.membershipNumber],
    );
    const id = rows[0].id as string;
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'association_membership.added',
      subjectType: 'association_membership',
      subjectId: id,
      detail: { associationName: input.associationName },
    });
    return { id };
  });
}

export async function listAssociationMemberships(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, association_name, membership_number, status, confirmed_by_association, created_at
       FROM association_memberships WHERE broker_profile_id = $1 ORDER BY created_at`,
      [brokerProfileId],
    );
    return rows;
  });
}

export async function updateAssociationMembership(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  membershipId: string,
  patch: { associationName?: string; membershipNumber?: string },
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows: statusRows } = await client.query(`SELECT status FROM broker_profiles WHERE id = $1`, [
      brokerProfileId,
    ]);
    if (statusRows.length === 0) throw new BrokerProfileNotFoundError(brokerProfileId);
    assertEditable(statusRows[0].status as string);

    const params: unknown[] = [membershipId, brokerProfileId];
    const setClauses: string[] = [];
    if (patch.associationName !== undefined) {
      params.push(patch.associationName);
      setClauses.push(`association_name = $${params.length}`);
    }
    if (patch.membershipNumber !== undefined) {
      params.push(patch.membershipNumber);
      setClauses.push(`membership_number = $${params.length}`);
    }
    if (setClauses.length === 0) return;

    const { rowCount } = await client.query(
      `UPDATE association_memberships SET ${setClauses.join(', ')} WHERE id = $1 AND broker_profile_id = $2`,
      params,
    );
    if (rowCount === 0) throw new AssociationMembershipNotFoundError(membershipId);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'association_membership.updated',
      subjectType: 'association_membership',
      subjectId: membershipId,
    });
  });
}

export async function deleteAssociationMembership(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  membershipId: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows: statusRows } = await client.query(`SELECT status FROM broker_profiles WHERE id = $1`, [
      brokerProfileId,
    ]);
    if (statusRows.length === 0) throw new BrokerProfileNotFoundError(brokerProfileId);
    assertEditable(statusRows[0].status as string);

    const { rowCount } = await client.query(
      `DELETE FROM association_memberships WHERE id = $1 AND broker_profile_id = $2`,
      [membershipId, brokerProfileId],
    );
    if (rowCount === 0) throw new AssociationMembershipNotFoundError(membershipId);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'association_membership.removed',
      subjectType: 'association_membership',
      subjectId: membershipId,
    });
  });
}
