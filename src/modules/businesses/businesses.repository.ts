import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';

export class BusinessNotFoundError extends Error {
  constructor(id: string) {
    super(`business not found: ${id}`);
    this.name = 'BusinessNotFoundError';
  }
}
export class BusinessNotEditableError extends Error {
  constructor(public readonly status: string) {
    super(`business cannot be edited while status is '${status}'`);
    this.name = 'BusinessNotEditableError';
  }
}
export type OutstandingItem = { field: string; reason: string };
export class BusinessIncompleteError extends Error {
  constructor(public readonly items: OutstandingItem[]) {
    super('business has outstanding items and cannot be submitted');
    this.name = 'BusinessIncompleteError';
  }
}
export class BusinessNotAffiliatableError extends Error {
  constructor(public readonly status: string) {
    super(`business is not open to new affiliation requests while status is '${status}'`);
    this.name = 'BusinessNotAffiliatableError';
  }
}
export class AlreadyAffiliatedError extends Error {
  constructor(businessId: string) {
    super(`already affiliated (or pending) with business: ${businessId}`);
    this.name = 'AlreadyAffiliatedError';
  }
}
export class AffiliationNotFoundError extends Error {
  constructor(id: string) {
    super(`affiliation not found: ${id}`);
    this.name = 'AffiliationNotFoundError';
  }
}
export class AffiliationNotPendingError extends Error {
  constructor(public readonly status: string) {
    super(`affiliation cannot be confirmed while status is '${status}'`);
    this.name = 'AffiliationNotPendingError';
  }
}
export class CannotConfirmOwnAffiliationError extends Error {
  constructor() {
    super('a broker cannot confirm their own affiliation request');
    this.name = 'CannotConfirmOwnAffiliationError';
  }
}
export class NotAffiliatedError extends Error {
  constructor(businessId: string) {
    super(`no active affiliation to business: ${businessId}`);
    this.name = 'NotAffiliatedError';
  }
}
export class PrincipalNotFoundError extends Error {
  constructor(id: string) {
    super(`principal not found: ${id}`);
    this.name = 'PrincipalNotFoundError';
  }
}

function assertEditable(status: string): void {
  if (status !== 'draft' && status !== 'attention_required') throw new BusinessNotEditableError(status);
}

export type EntityType = 'company' | 'sole_trader' | 'partnership' | 'trust';
type AddressLike = { line1?: string; line2?: string; city?: string; postcode?: string; state?: string };

// ---------------------------------------------------------------------------
// Create, read, update (BUS-001, BUS-003, BUS-013)
// ---------------------------------------------------------------------------

/**
 * BUS-003/013: creates the business and its founding affiliation in one transaction.
 * The founding affiliation is immediately `status = 'active'` — there is no one else
 * affiliated yet to confirm it, unlike every subsequent join (see requestAffiliation).
 *
 * For a sole trader (BUS-013's "without asking twice"): legalName defaults to the
 * broker's own name if not supplied, and a business_principals row is auto-created
 * from the broker's own profile fields — the broker is never asked to re-enter their
 * own name/DOB a second time as "the principal."
 */
export async function createBusiness(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  input: {
    entityType: EntityType;
    legalName?: string;
    tradingName?: string;
    abn?: string;
    acn?: string;
    gstRegistered?: boolean;
    trusteeName?: string;
    website?: string;
    businessEmail?: string;
    address?: AddressLike;
    mailingAddress?: AddressLike;
  },
): Promise<{ id: string }> {
  return withAuthorizationContext(ctx, async (client) => {
    let legalName = input.legalName;
    let soleTraderBroker: { first_name: string; last_name: string; date_of_birth: string | null; email: string } | null =
      null;

    if (input.entityType === 'sole_trader') {
      const { rows } = await client.query(
        `SELECT first_name, last_name, date_of_birth, email FROM broker_profiles WHERE id = $1`,
        [brokerProfileId],
      );
      soleTraderBroker = rows[0];
      if (!legalName && soleTraderBroker) {
        legalName = `${soleTraderBroker.first_name} ${soleTraderBroker.last_name}`;
      }
    }

    // Explicit id, not `RETURNING id`: broker_businesses_visibility (RLS) now requires
    // an ACTIVE business_affiliations row to exist for the business (migration 0019),
    // but that row is only created in the very next statement, in the same
    // transaction — `RETURNING` implicitly re-checks the new row against the table's
    // SELECT policy, which would fail here since the founding affiliation doesn't
    // exist yet at that instant. Generating the id ourselves sidesteps the ordering
    // problem entirely rather than reordering two inserts that both need the other's
    // key. Caught by business-affiliations-rls.spec.ts erroring with "new row violates
    // row-level security policy" the first time this ran end to end.
    const businessId = randomUUID();
    await client.query(
      `INSERT INTO broker_businesses
         (id, entity_type, legal_name, trading_name, abn, acn, gst_registered, trustee_name,
          website, business_email, address, mailing_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        businessId,
        input.entityType,
        legalName,
        input.tradingName ?? null,
        input.abn ?? null,
        input.acn ?? null,
        input.gstRegistered ?? null,
        input.trusteeName ?? null,
        input.website ?? null,
        input.businessEmail ?? null,
        input.address ? JSON.stringify(input.address) : null,
        input.mailingAddress ? JSON.stringify(input.mailingAddress) : null,
      ],
    );

    await client.query(
      `INSERT INTO business_affiliations (broker_profile_id, broker_business_id, role, status)
       VALUES ($1, $2, 'principal', 'active')`,
      [brokerProfileId, businessId],
    );

    if (soleTraderBroker) {
      await client.query(
        `INSERT INTO business_principals
           (broker_business_id, role, first_name, last_name, date_of_birth, broker_profile_id, email)
         VALUES ($1, 'sole_trader', $2, $3, $4, $5, $6)`,
        [
          businessId,
          soleTraderBroker.first_name,
          soleTraderBroker.last_name,
          soleTraderBroker.date_of_birth,
          brokerProfileId,
          soleTraderBroker.email,
        ],
      );
    }

    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'broker_business.created',
      subjectType: 'broker_business',
      subjectId: businessId,
      detail: { entityType: input.entityType },
    });

    return { id: businessId };
  });
}

export async function getBusiness(
  ctx: AuthorizationContext,
  businessId: string,
): Promise<Record<string, unknown> | null> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, entity_type, legal_name, trading_name, abn, acn, gst_registered, trustee_name,
              website, business_email, address, mailing_address, status, created_at, updated_at
       FROM broker_businesses WHERE id = $1`,
      [businessId],
    );
    return rows[0] ?? null;
  });
}

const BUSINESS_UPDATABLE_FIELDS: Record<string, string> = {
  legalName: 'legal_name',
  tradingName: 'trading_name',
  abn: 'abn',
  acn: 'acn',
  gstRegistered: 'gst_registered',
  trusteeName: 'trustee_name',
  website: 'website',
  businessEmail: 'business_email',
  address: 'address',
  mailingAddress: 'mailing_address',
  // entityType is deliberately NOT here — changing it post-creation is a restructure
  // (BUS-021, Section 6.5 W5), out of Epic 4's scope entirely.
};

function serializeBusinessValue(key: string, value: unknown): unknown {
  return key === 'address' || key === 'mailingAddress' ? JSON.stringify(value) : value;
}

/** BUS-001/006. Only permitted while draft/attention_required — same gating Epic 3 established for broker profiles. */
export async function updateBusiness(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  businessId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([key]) => key in BUSINESS_UPDATABLE_FIELDS);
  if (entries.length === 0) return;

  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_businesses WHERE id = $1`, [businessId]);
    if (rows.length === 0) throw new BusinessNotFoundError(businessId);
    assertEditable(rows[0].status as string);

    const params: unknown[] = [businessId];
    const setClauses = entries.map(([key, value]) => {
      params.push(serializeBusinessValue(key, value));
      return `${BUSINESS_UPDATABLE_FIELDS[key]} = $${params.length}`;
    });

    await client.query(`UPDATE broker_businesses SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1`, params);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'broker_business.updated',
      subjectType: 'broker_business',
      subjectId: businessId,
      detail: { fields: entries.map(([key]) => key) },
    });
  });
}

// ---------------------------------------------------------------------------
// Outstanding items / submit
// ---------------------------------------------------------------------------

type BusinessFieldsForCompleteness = {
  legal_name: string | null;
  abn: string | null;
  acn: string | null;
  gst_registered: boolean | null;
  business_email: string | null;
  address: AddressLike | null;
  entity_type: string | null;
  trustee_name: string | null;
};

/** Mirrors brokers.repository.ts's computeOutstandingItems — one function, used by both getOutstandingItems and submitBusiness's atomic gate. */
function computeBusinessOutstandingItems(b: BusinessFieldsForCompleteness, principalCount: number): OutstandingItem[] {
  const items: OutstandingItem[] = [];
  const require = (value: unknown, field: string, reason: string) => {
    if (value === null || value === undefined || value === '') items.push({ field, reason });
  };

  require(b.legal_name, 'legalName', 'Legal entity name is required.');
  if (!b.abn && !b.acn) items.push({ field: 'registrationNumber', reason: 'An ABN or ACN is required.' });
  if (b.gst_registered === null || b.gst_registered === undefined) {
    items.push({ field: 'gstRegistered', reason: 'GST registration status is required.' });
  }
  require(b.business_email, 'businessEmail', 'Business email is required.');

  const a = b.address;
  if (!a || !a.line1 || !a.city || !a.postcode || !a.state) {
    items.push({ field: 'address', reason: 'Business address (line 1, city, postcode, state) is required.' });
  }

  if (b.entity_type === 'trust') {
    require(b.trustee_name, 'trusteeName', 'Trustee name is required for a trust.');
  }

  if (principalCount === 0) {
    items.push({ field: 'principals', reason: 'At least one principal is required.' });
  }

  return items;
}

async function fetchBusinessCompletenessInputs(
  client: PoolClient,
  businessId: string,
): Promise<{ business: BusinessFieldsForCompleteness; principalCount: number }> {
  const { rows } = await client.query(
    `SELECT legal_name, abn, acn, gst_registered, business_email, address, entity_type, trustee_name
     FROM broker_businesses WHERE id = $1`,
    [businessId],
  );
  if (rows.length === 0) throw new BusinessNotFoundError(businessId);

  const { rows: principals } = await client.query(
    `SELECT id FROM business_principals WHERE broker_business_id = $1 AND removed_at IS NULL`,
    [businessId],
  );

  return { business: rows[0] as BusinessFieldsForCompleteness, principalCount: principals.length };
}

export async function getOutstandingItems(ctx: AuthorizationContext, businessId: string): Promise<OutstandingItem[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { business, principalCount } = await fetchBusinessCompletenessInputs(client, businessId);
    return computeBusinessOutstandingItems(business, principalCount);
  });
}

/** BUS-001: draft/attention_required -> submitted, gated atomically on the same computation as getOutstandingItems. */
export async function submitBusiness(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  businessId: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_businesses WHERE id = $1`, [businessId]);
    if (rows.length === 0) throw new BusinessNotFoundError(businessId);
    assertEditable(rows[0].status as string);

    const { business, principalCount } = await fetchBusinessCompletenessInputs(client, businessId);
    const items = computeBusinessOutstandingItems(business, principalCount);
    if (items.length > 0) throw new BusinessIncompleteError(items);

    await client.query(`UPDATE broker_businesses SET status = 'submitted', updated_at = now() WHERE id = $1`, [
      businessId,
    ]);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'broker_business.submitted',
      subjectType: 'broker_business',
      subjectId: businessId,
    });
  });
}

// ---------------------------------------------------------------------------
// Search + affiliation (BUS-004, BUS-005, BUS-006, BUS-014, BUS-015)
// ---------------------------------------------------------------------------

/**
 * BUS-004/006: finding an existing business to affiliate with necessarily has to work
 * BEFORE the caller has any affiliation to it — broker_businesses_visibility (RLS,
 * migration 0019) only grants visibility to an ALREADY-active affiliate, by design.
 * This intentionally runs as 'system' (bypassing that check) rather than the caller's
 * own ctx, and — to avoid leaking anything beyond what a directory search should —
 * selects a minimal identifying column set, not the full business record. No ctx
 * parameter: this always runs as system regardless of who's calling; the controller's
 * guard is what restricts the endpoint to authenticated brokers.
 */
export async function searchVerifiedBusinesses(query: {
  abn?: string;
  acn?: string;
}): Promise<Array<Record<string, unknown>>> {
  const conditions: string[] = [`status IN ('verified', 'active')`];
  const params: unknown[] = [];
  if (query.abn) {
    params.push(query.abn);
    conditions.push(`abn = $${params.length}`);
  }
  if (query.acn) {
    params.push(query.acn);
    conditions.push(`acn = $${params.length}`);
  }
  if (params.length === 0) return []; // require at least one search term, not a full directory listing

  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, entity_type, legal_name, trading_name, status FROM broker_businesses WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return rows;
  });
}

/** BUS-004/005: creates a pending request — see confirmAffiliation for how it becomes current. */
export async function requestAffiliation(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  businessId: string,
): Promise<{ id: string }> {
  // Business status has to be checked as 'system': broker_businesses_visibility (RLS,
  // migration 0019) only grants visibility to a broker who ALREADY holds an active
  // affiliation — but this function exists specifically for a broker who does not.
  // Same reasoning as searchVerifiedBusinesses's own comment; a narrow, single-column
  // read, not a broad bypass. Caught by business-affiliations-rls.spec.ts erroring
  // with BusinessNotFoundError even for a business that does exist and is verified.
  const bizStatus = await withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_businesses WHERE id = $1`, [businessId]);
    return (rows[0]?.status as string | undefined) ?? null;
  });
  if (bizStatus === null) throw new BusinessNotFoundError(businessId);
  if (bizStatus !== 'verified' && bizStatus !== 'active') throw new BusinessNotAffiliatableError(bizStatus);

  return withAuthorizationContext(ctx, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT id FROM business_affiliations
       WHERE broker_business_id = $1 AND broker_profile_id = $2 AND status IN ('active', 'pending_confirmation')`,
      [businessId, brokerProfileId],
    );
    if (existing.length > 0) throw new AlreadyAffiliatedError(businessId);

    const { rows } = await client.query(
      `INSERT INTO business_affiliations (broker_profile_id, broker_business_id, role, status)
       VALUES ($1, $2, 'principal', 'pending_confirmation') RETURNING id`,
      [brokerProfileId, businessId],
    );
    const id = rows[0].id as string;
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'business_affiliation.requested',
      subjectType: 'business_affiliation',
      subjectId: id,
      detail: { businessId },
    });
    return { id };
  });
}

/**
 * BUS-005: "confirmation from the business," modelled as confirmation from any OTHER
 * broker already actively affiliated with it — never the requester themselves (see
 * CannotConfirmOwnAffiliationError), otherwise "confirmation" would be meaningless.
 */
export async function confirmAffiliation(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  businessId: string,
  affiliationId: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows: myRows } = await client.query(
      `SELECT id FROM business_affiliations
       WHERE broker_business_id = $1 AND broker_profile_id = $2 AND status = 'active'`,
      [businessId, brokerProfileId],
    );
    if (myRows.length === 0) throw new NotAffiliatedError(businessId);

    const { rows: targetRows } = await client.query(
      `SELECT broker_profile_id, status FROM business_affiliations WHERE id = $1 AND broker_business_id = $2`,
      [affiliationId, businessId],
    );
    if (targetRows.length === 0) throw new AffiliationNotFoundError(affiliationId);
    const target = targetRows[0];
    if (target.broker_profile_id === brokerProfileId) throw new CannotConfirmOwnAffiliationError();
    if (target.status !== 'pending_confirmation') throw new AffiliationNotPendingError(target.status);

    await client.query(`UPDATE business_affiliations SET status = 'active' WHERE id = $1`, [affiliationId]);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'business_affiliation.confirmed',
      subjectType: 'business_affiliation',
      subjectId: affiliationId,
      detail: { businessId, confirmedBrokerProfileId: target.broker_profile_id },
    });
  });
}

/** BUS-014/015: a broker may only end THEIR OWN affiliation (leave) — never someone else's. Never deleted, per BUS-015. */
export async function endAffiliation(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  affiliationId: string,
  reason?: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE business_affiliations SET status = 'ended', ended_at = now(), end_reason = $3
       WHERE id = $1 AND broker_profile_id = $2 AND status IN ('active', 'pending_confirmation')`,
      [affiliationId, brokerProfileId, reason ?? null],
    );
    if (rowCount === 0) throw new AffiliationNotFoundError(affiliationId);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'business_affiliation.ended',
      subjectType: 'business_affiliation',
      subjectId: affiliationId,
      detail: { reason: reason ?? null },
    });
  });
}

/** BUS-015: full history for the caller, current and past. LEFT JOIN: a still-pending affiliation's business isn't visible via broker_businesses_visibility yet, so those columns come back null rather than hiding the affiliation row itself. */
export async function listMyAffiliations(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT ba.id, ba.broker_business_id, ba.role, ba.status, ba.started_at, ba.ended_at, ba.end_reason,
              bb.legal_name, bb.trading_name, bb.entity_type
       FROM business_affiliations ba
       LEFT JOIN broker_businesses bb ON bb.id = ba.broker_business_id
       WHERE ba.broker_profile_id = $1
       ORDER BY ba.started_at DESC`,
      [brokerProfileId],
    );
    return rows;
  });
}

/** For an actively-affiliated broker to see who else is confirmed/pending on their business. */
export async function listBusinessAffiliations(
  ctx: AuthorizationContext,
  businessId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, broker_profile_id, role, status, started_at, ended_at, end_reason
       FROM business_affiliations WHERE broker_business_id = $1 ORDER BY started_at`,
      [businessId],
    );
    return rows;
  });
}

// ---------------------------------------------------------------------------
// Principals (BUS-007)
// ---------------------------------------------------------------------------

export async function addPrincipal(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  businessId: string,
  input: { role: string; firstName: string; lastName: string; dateOfBirth?: string; email?: string },
): Promise<{ id: string }> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_businesses WHERE id = $1`, [businessId]);
    if (rows.length === 0) throw new BusinessNotFoundError(businessId);
    assertEditable(rows[0].status as string);

    const { rows: inserted } = await client.query(
      `INSERT INTO business_principals (broker_business_id, role, first_name, last_name, date_of_birth, email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [businessId, input.role, input.firstName, input.lastName, input.dateOfBirth ?? null, input.email ?? null],
    );
    const id = inserted[0].id as string;
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'business_principal.added',
      subjectType: 'business_principal',
      subjectId: id,
      detail: { businessId, role: input.role },
    });
    return { id };
  });
}

export async function listPrincipals(
  ctx: AuthorizationContext,
  businessId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, role, first_name, last_name, date_of_birth, email, broker_profile_id, created_at
       FROM business_principals WHERE broker_business_id = $1 AND removed_at IS NULL ORDER BY created_at`,
      [businessId],
    );
    return rows;
  });
}

const PRINCIPAL_UPDATABLE_FIELDS: Record<string, string> = {
  role: 'role',
  firstName: 'first_name',
  lastName: 'last_name',
  dateOfBirth: 'date_of_birth',
  email: 'email',
};

export async function updatePrincipal(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  businessId: string,
  principalId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([key]) => key in PRINCIPAL_UPDATABLE_FIELDS);
  if (entries.length === 0) return;

  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_businesses WHERE id = $1`, [businessId]);
    if (rows.length === 0) throw new BusinessNotFoundError(businessId);
    assertEditable(rows[0].status as string);

    const params: unknown[] = [principalId, businessId];
    const setClauses = entries.map(([key, value]) => {
      params.push(value);
      return `${PRINCIPAL_UPDATABLE_FIELDS[key]} = $${params.length}`;
    });

    const { rowCount } = await client.query(
      `UPDATE business_principals SET ${setClauses.join(', ')}
       WHERE id = $1 AND broker_business_id = $2 AND removed_at IS NULL`,
      params,
    );
    if (rowCount === 0) throw new PrincipalNotFoundError(principalId);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'business_principal.updated',
      subjectType: 'business_principal',
      subjectId: principalId,
      detail: { businessId },
    });
  });
}

/** Soft-delete (removed_at) — never a hard DELETE, principals are screening subjects (BUS-007). */
export async function removePrincipal(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  businessId: string,
  principalId: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM broker_businesses WHERE id = $1`, [businessId]);
    if (rows.length === 0) throw new BusinessNotFoundError(businessId);
    assertEditable(rows[0].status as string);

    const { rowCount } = await client.query(
      `UPDATE business_principals SET removed_at = now() WHERE id = $1 AND broker_business_id = $2 AND removed_at IS NULL`,
      [principalId, businessId],
    );
    if (rowCount === 0) throw new PrincipalNotFoundError(principalId);
    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'business_principal.removed',
      subjectType: 'business_principal',
      subjectId: principalId,
      detail: { businessId },
    });
  });
}
