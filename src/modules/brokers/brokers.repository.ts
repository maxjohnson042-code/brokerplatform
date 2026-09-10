import type { PoolClient } from 'pg';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { createNotification } from '../notifications/notification.repository';
import { profileSubmittedTemplate } from '../notifications/notification-templates';
import { listMyAffiliations, getOutstandingItems as getBusinessOutstandingItems } from '../businesses/businesses.repository';
import { listMine as listMyAccreditations, getOutstandingItems as getAccreditationOutstandingItems } from '../accreditation/accreditation.repository';

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
              photo_url, status, attested_terms_at, created_at, updated_at
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

/**
 * UI polish: profile photo (avatar). Deliberately NOT gated by assertEditable —
 * unlike the compliance fields updateBrokerProfile guards, a photo is cosmetic and
 * doesn't affect accreditation state, so a broker can change it at any profile
 * status, submitted or not.
 */
export async function updateMyPhoto(ctx: AuthorizationContext, brokerProfileId: string, photoUrl: string): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE broker_profiles SET photo_url = $2, updated_at = now() WHERE id = $1`,
      [brokerProfileId, photoUrl],
    );
    if (rowCount === 0) throw new BrokerProfileNotFoundError(brokerProfileId);
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
export async function submitProfile(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<{ notificationId: string; recipientEmail: string; shouldSend: boolean; subject: string; body: string }> {
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

    // NOT-001: "brokers notified on submission" — logged atomically with the status
    // change above (same transaction), same fix as every other Epic 12 call site.
    const { subject, body } = profileSubmittedTemplate();
    const notification = await createNotification(client, ctx, {
      recipientType: 'broker',
      recipientId: brokerProfileId,
      category: 'profile_submitted',
      subject,
      body,
      relatedRecordType: 'broker_profile',
      relatedRecordId: brokerProfileId,
    });
    return { notificationId: notification.id, recipientEmail: notification.recipientEmail, shouldSend: notification.shouldSend, subject, body };
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

// ---------------------------------------------------------------------------
// Epic 13 — PRF-003 (outstanding tasks across all relationships), AUD-003 (access
// history), AUD-005 (point-in-time reconstruction). Cross-module imports above
// (businesses/accreditation) are on precedent — businesses.repository.ts already
// imports flagPartyChanged from accreditation the same way. If a fourth module ever
// needs pulling in here, that's the signal to extract a dedicated aggregation
// module, not to keep growing this one.
// ---------------------------------------------------------------------------

export type AccessHistoryEntry = {
  occurred_at: string;
  organisation_name: string | null;
  document_type: string | null;
  original_filename: string | null;
};

/**
 * AUD-003: "which organisations viewed what, and when" — reads the audit_log rows
 * getDocumentForDownload now writes (evidence.repository.ts), joined out to the
 * evidence row itself (for the document's type/filename) and the viewing
 * organisation's name. Scoped to the broker's own PROFILE evidence only — see
 * migration 0027's own comment on why broker_business evidence is a deliberate cut.
 */
export async function listAccessHistory(ctx: AuthorizationContext, brokerProfileId: string): Promise<AccessHistoryEntry[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<AccessHistoryEntry>(
      `SELECT al.occurred_at, co.name AS organisation_name, e.document_type, e.original_filename
       FROM audit_log al
       JOIN evidence e ON e.id = al.subject_id
       LEFT JOIN client_organisations co ON co.id = al.client_organisation_id
       WHERE al.action = 'evidence.viewed'
         AND e.subject_type = 'broker_profile' AND e.subject_id = $1
       ORDER BY al.occurred_at DESC`,
      [brokerProfileId],
    );
    return rows;
  });
}

export type OutstandingSummaryItem = {
  source: 'profile' | 'business' | 'accreditation';
  sourceId: string;
  sourceLabel: string;
  groupId: string;
  label: string;
  reason: string;
};

/**
 * PRF-003: one rollup across the three outstanding-items sources that already exist
 * (this module's own getOutstandingItems, businesses', accreditation's) — nothing
 * combined them before this. listMyAffiliations returns every affiliation
 * regardless of status, but broker_businesses_visibility only grants a broker
 * visibility into ACTIVE ones — filtered here, or a pending/ended affiliation's id
 * would 404 inside getBusinessOutstandingItems and take down the whole summary.
 * Each per-source call is also individually guarded so one bad accreditation/
 * business doesn't blank the rest of the list.
 */
export async function getOutstandingSummary(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<OutstandingSummaryItem[]> {
  const items: OutstandingSummaryItem[] = [];

  const profileItems = await getOutstandingItems(ctx, brokerProfileId);
  for (const item of profileItems) {
    items.push({
      source: 'profile',
      sourceId: brokerProfileId,
      sourceLabel: 'My profile',
      groupId: item.field,
      label: item.field,
      reason: item.reason,
    });
  }

  const affiliations = await listMyAffiliations(ctx, brokerProfileId);
  for (const affiliation of affiliations) {
    if (affiliation.status !== 'active') continue;
    const businessId = affiliation.broker_business_id as string;
    const label = (affiliation.trading_name as string | null) ?? (affiliation.legal_name as string | null) ?? 'My business';
    try {
      const businessItems = await getBusinessOutstandingItems(ctx, businessId);
      for (const item of businessItems) {
        items.push({ source: 'business', sourceId: businessId, sourceLabel: label, groupId: item.field, label: item.field, reason: item.reason });
      }
    } catch {
      // One unreadable business shouldn't blank the rest of the summary.
    }
  }

  const accreditations = await listMyAccreditations(ctx, brokerProfileId);
  for (const accreditation of accreditations) {
    const label = `${accreditation.brand} — ${accreditation.role}`;
    try {
      const result = await getAccreditationOutstandingItems(ctx, accreditation.id);
      if (result.rulesetConfigured) {
        for (const item of result.items) {
          items.push({
            source: 'accreditation',
            sourceId: accreditation.id,
            sourceLabel: label,
            groupId: item.groupId,
            label: item.label,
            reason: item.reason,
          });
        }
      }
    } catch {
      // Same defensive skip as the business loop above.
    }
  }

  return items;
}

// AUD-005: an accreditation's status is a plain mutable column with no temporal
// table of its own — reconstructed instead by replaying its audit_log history.
// Only these actions change status; interview_recorded/training_confirmed don't and
// are deliberately absent from this map, not just "unmapped" — a row with either of
// those actions is skipped, not treated as resetting the status to nothing.
const ACCREDITATION_STATUS_BY_ACTION: Record<string, string> = {
  'accreditation.requested': 'requested',
  'accreditation.information_requested': 'information_required',
  'accreditation.escalated': 'exception_escalated',
  'accreditation.approved': 'pending',
  'accreditation.declined': 'declined',
  'accreditation.activated': 'active',
  'accreditation.lapsed': 'lapsed',
  'accreditation.party_changed': 'party_changed_pending',
};

export type Reconstruction = {
  asOf: string;
  accreditations: Array<{ id: string; brand: string; role: string; classification: string; status: string }>;
  checkResults: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
};

/**
 * AUD-005: "the platform can show a broker's complete verified state as at any past
 * date" — the master doc is explicit the temporal schema (check_result's
 * valid_from/valid_to, evidence's captured_at/valid_to) was built across every prior
 * epic specifically to make this possible; this is the first thing that actually
 * exercises it. An accreditation with zero audit_log rows at/before asOf is left out
 * of the result entirely (it didn't exist yet as of that date) rather than given a
 * null status.
 */
export async function reconstructAsOf(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  asOf: Date,
): Promise<Reconstruction> {
  return withAuthorizationContext(ctx, async (client) => {
    const asOfIso = asOf.toISOString();

    const { rows: accreditationRows } = await client.query(
      `SELECT id, brand, role, classification FROM accreditations WHERE broker_profile_id = $1`,
      [brokerProfileId],
    );

    const accreditations: Reconstruction['accreditations'] = [];
    for (const acc of accreditationRows) {
      const { rows: history } = await client.query<{ action: string }>(
        `SELECT action FROM audit_log
         WHERE subject_type = 'accreditation' AND subject_id = $1 AND occurred_at <= $2
         ORDER BY occurred_at ASC`,
        [acc.id, asOfIso],
      );
      let status: string | null = null;
      for (const row of history) {
        const mapped = ACCREDITATION_STATUS_BY_ACTION[row.action];
        if (mapped) status = mapped;
      }
      if (status) {
        accreditations.push({ id: acc.id, brand: acc.brand, role: acc.role, classification: acc.classification, status });
      }
    }

    const { rows: businessIdRows } = await client.query<{ broker_business_id: string }>(
      `SELECT broker_business_id FROM business_affiliations WHERE broker_profile_id = $1 AND status = 'active'`,
      [brokerProfileId],
    );
    const businessIds = businessIdRows.map((r) => r.broker_business_id);

    const { rows: checkResults } = await client.query(
      `SELECT * FROM check_result
       WHERE ((subject_type = 'broker_profile' AND subject_id = $1)
          OR (subject_type = 'broker_business' AND subject_id = ANY($2::uuid[])))
         AND valid_from <= $3
         AND (valid_to IS NULL OR valid_to > $3)`,
      [brokerProfileId, businessIds, asOfIso],
    );

    // document_type IS NOT NULL: same filter listCurrentDocuments uses to exclude
    // Sumsub provider-payload rows — those are represented via checkResults above,
    // not double-counted here as "documents".
    const { rows: documents } = await client.query(
      `SELECT * FROM evidence
       WHERE ((subject_type = 'broker_profile' AND subject_id = $1)
          OR (subject_type = 'broker_business' AND subject_id = ANY($2::uuid[])))
         AND document_type IS NOT NULL
         AND captured_at <= $3
         AND (valid_to IS NULL OR valid_to > $3)`,
      [brokerProfileId, businessIds, asOfIso],
    );

    return { asOf: asOfIso, accreditations, checkResults, documents };
  });
}
