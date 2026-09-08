import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { resolve as resolveRuleset } from '../rulesets/rulesets.repository';
import { computeOutstandingRequirements } from '../rulesets/ruleset-evaluator';
import { Fact, OutstandingRequirement, SubjectType } from '../rulesets/ruleset.types';

export type AccreditationClassification = 'new_broker_introducer' | 'new_referrer_introducer' | 'transfer' | 'add_on';
export type AccreditationStatus = 'requested' | 'information_required' | 'exception_escalated' | 'declined' | 'pending' | 'party_changed_pending';
export type LicenceHolderType = 'aggregator_organisation' | 'broking_business' | 'third_party';
export type DecisionStep = 'reviewer' | 'senior_approver';

export type Accreditation = {
  id: string;
  lender_client_organisation_id: string;
  broker_profile_id: string;
  broker_business_id: string;
  relationship_id: string | null;
  classification: AccreditationClassification;
  brand: string;
  role: string;
  product_scope: string;
  pathway: string;
  ruleset_version_id: string | null;
  licence_holder_type: LicenceHolderType;
  licence_holder_client_organisation_id: string | null;
  licence_holder_broker_business_id: string | null;
  licence_holder_name: string | null;
  is_corporate_credit_representative: boolean;
  lender_issued_id: string | null;
  previous_lender_issued_ids: string[];
  status: AccreditationStatus;
  current_decision_step: DecisionStep;
  interview_recommendation: string | null;
  party_changed_at: string | null;
  requested_at: string;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccreditationDecision = {
  id: string;
  accreditation_id: string;
  actor_type: string;
  actor_id: string | null;
  decision_type: 'information_requested' | 'escalated' | 'approved' | 'declined' | 'interview_recorded';
  rationale: string | null;
  itemised_reasons: string[] | null;
  created_at: string;
};

export class AccreditationNotFoundError extends Error {
  constructor(id: string) {
    super(`accreditation not found: ${id}`);
    this.name = 'AccreditationNotFoundError';
  }
}
export class NoBusinessAffiliationError extends Error {
  constructor(businessId: string) {
    super(`no active affiliation with business: ${businessId}`);
    this.name = 'NoBusinessAffiliationError';
  }
}
export class NoActiveRelationshipError extends Error {
  constructor(clientOrganisationId: string) {
    super(`no active relationship with organisation: ${clientOrganisationId}`);
    this.name = 'NoActiveRelationshipError';
  }
}
export class InvalidAccreditationTransitionError extends Error {
  constructor(status: string, attempted: string) {
    super(`cannot ${attempted} an accreditation while status is '${status}'`);
    this.name = 'InvalidAccreditationTransitionError';
  }
}
export class InsufficientRoleError extends Error {
  constructor(message = 'insufficient role to act on this accreditation') {
    super(message);
    this.name = 'InsufficientRoleError';
  }
}

function actorIdOf(ctx: AuthorizationContext): string | undefined {
  return 'actorId' in ctx ? ctx.actorId : undefined;
}

/**
 * ACR-001/002/010: the four-party record. Validates the two sequencing preconditions
 * from Section 6.1/6.2 before creating anything — an active business affiliation
 * (Section 6.1's "cannot reach accreditation with a lender without one, because the
 * authority chain cannot be validated") and an active relationship with the lender
 * (W2 must precede W3 — "request appears in that client's queue" presumes the
 * relationship already exists).
 *
 * Resolves the applicable ruleset_version via Epic 9's resolve() as a system-actor
 * read (same precedent as relationships.repository.ts's inviteBroker looking up a
 * broker by email) — the broker's own ctx has no RLS visibility into ruleset_versions
 * by design (Epic 9: brokers never read raw ruleset JSON), and this needs a separate,
 * completed call rather than nesting inside the insert transaction below, same
 * shape as every other cross-repository lookup in this codebase.
 */
export async function requestAccreditation(
  ctx: AuthorizationContext,
  input: {
    brokerProfileId: string;
    lenderClientOrganisationId: string;
    brokerBusinessId: string;
    classification: AccreditationClassification;
    brand: string;
    role: string;
    productScope: string;
    licenceHolderType: LicenceHolderType;
    licenceHolderClientOrganisationId?: string;
    licenceHolderBrokerBusinessId?: string;
    licenceHolderName?: string;
    isCorporateCreditRepresentative?: boolean;
  },
): Promise<{ id: string }> {
  const pathway = input.classification === 'transfer' ? 'transfer' : 'new';
  const resolved = await resolveRuleset(
    { actorType: 'system' },
    {
      clientOrganisationId: input.lenderClientOrganisationId,
      brand: input.brand,
      role: input.role,
      productScope: input.productScope,
      pathway,
    },
  );

  return withAuthorizationContext(ctx, async (client) => {
    const { rows: affiliationRows } = await client.query(
      `SELECT id FROM business_affiliations
       WHERE broker_profile_id = $1 AND broker_business_id = $2 AND status = 'active'`,
      [input.brokerProfileId, input.brokerBusinessId],
    );
    if (affiliationRows.length === 0) throw new NoBusinessAffiliationError(input.brokerBusinessId);

    const { rows: relationshipRows } = await client.query(
      `SELECT id FROM relationships
       WHERE broker_profile_id = $1 AND client_organisation_id = $2 AND status = 'active' AND effective_to IS NULL`,
      [input.brokerProfileId, input.lenderClientOrganisationId],
    );
    if (relationshipRows.length === 0) throw new NoActiveRelationshipError(input.lenderClientOrganisationId);
    const relationshipId = relationshipRows[0].id as string;

    const id = randomUUID();
    await client.query(
      `INSERT INTO accreditations (
         id, lender_client_organisation_id, broker_profile_id, broker_business_id, relationship_id,
         classification, brand, role, product_scope, pathway, ruleset_version_id,
         licence_holder_type, licence_holder_client_organisation_id, licence_holder_broker_business_id,
         licence_holder_name, is_corporate_credit_representative
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        input.lenderClientOrganisationId,
        input.brokerProfileId,
        input.brokerBusinessId,
        relationshipId,
        input.classification,
        input.brand,
        input.role,
        input.productScope,
        pathway,
        resolved?.id ?? null,
        input.licenceHolderType,
        input.licenceHolderClientOrganisationId ?? null,
        input.licenceHolderBrokerBusinessId ?? null,
        input.licenceHolderName ?? null,
        input.isCorporateCreditRepresentative ?? false,
      ],
    );

    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: input.brokerProfileId,
      action: 'accreditation.requested',
      subjectType: 'accreditation',
      subjectId: id,
      clientOrganisationId: input.lenderClientOrganisationId,
      detail: { classification: input.classification, brand: input.brand, role: input.role, productScope: input.productScope },
    });

    return { id };
  });
}

export type QueueFilters = { status?: AccreditationStatus; classification?: AccreditationClassification; productScope?: string };

export async function listQueue(ctx: AuthorizationContext, lenderClientOrganisationId: string, filters: QueueFilters = {}): Promise<Accreditation[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const conditions = ['lender_client_organisation_id = $1'];
    const params: unknown[] = [lenderClientOrganisationId];
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.classification) {
      params.push(filters.classification);
      conditions.push(`classification = $${params.length}`);
    }
    if (filters.productScope) {
      params.push(filters.productScope);
      conditions.push(`product_scope = $${params.length}`);
    }
    const { rows } = await client.query<Accreditation>(
      `SELECT * FROM accreditations WHERE ${conditions.join(' AND ')} ORDER BY requested_at DESC`,
      params,
    );
    return rows;
  });
}

export async function listMine(ctx: AuthorizationContext, brokerProfileId: string): Promise<Accreditation[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<Accreditation>(
      `SELECT * FROM accreditations WHERE broker_profile_id = $1 ORDER BY requested_at DESC`,
      [brokerProfileId],
    );
    return rows;
  });
}

async function getAccreditationOrThrow(client: PoolClient, id: string): Promise<Accreditation> {
  const { rows } = await client.query<Accreditation>(`SELECT * FROM accreditations WHERE id = $1`, [id]);
  if (!rows[0]) throw new AccreditationNotFoundError(id);
  return rows[0];
}

async function getClientUserRole(client: PoolClient, clientUserId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT role FROM client_users WHERE id = $1`, [clientUserId]);
  return rows[0]?.role ?? null;
}

function assertNotTerminal(accreditation: Accreditation, attempted: string): void {
  if (accreditation.status === 'declined') throw new InvalidAccreditationTransitionError(accreditation.status, attempted);
}

/**
 * Decisions are lender-side only. A broker can SELECT their own accreditation (so
 * getAccreditationOrThrow above would happily find it for them), but must never be
 * able to act on it — checked explicitly here rather than relying only on RLS
 * silently filtering the UPDATE to zero rows, and rather than relying only on the
 * controller's requireClientUser() guard, same defense-in-depth reasoning as every
 * other repository function's own ownership checks in this codebase.
 */
function assertClientUserOrSystem(ctx: AuthorizationContext): void {
  if (ctx.actorType !== 'client_user' && ctx.actorType !== 'system') {
    throw new InsufficientRoleError('only a client organisation user may act on an accreditation');
  }
}

/** REV-002: everything a reviewer needs on one screen, one transaction. */
export async function getFullContext(ctx: AuthorizationContext, accreditationId: string) {
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);

    const { rows: profileRows } = await client.query(`SELECT * FROM broker_profiles WHERE id = $1`, [accreditation.broker_profile_id]);
    const { rows: businessRows } = await client.query(`SELECT * FROM broker_businesses WHERE id = $1`, [accreditation.broker_business_id]);
    const { rows: evidenceRows } = await client.query(
      `SELECT * FROM evidence WHERE subject_type = 'broker_profile' AND subject_id = $1 AND valid_to IS NULL
       UNION ALL
       SELECT * FROM evidence WHERE subject_type = 'broker_business' AND subject_id = $2 AND valid_to IS NULL`,
      [accreditation.broker_profile_id, accreditation.broker_business_id],
    );
    const { rows: checkResultRows } = await client.query(
      `SELECT * FROM check_result WHERE subject_type = 'broker_profile' AND subject_id = $1 AND valid_to IS NULL
       UNION ALL
       SELECT * FROM check_result WHERE subject_type = 'broker_business' AND subject_id = $2 AND valid_to IS NULL`,
      [accreditation.broker_profile_id, accreditation.broker_business_id],
    );
    const { rows: decisions } = await client.query<AccreditationDecision>(
      `SELECT * FROM accreditation_decisions WHERE accreditation_id = $1 ORDER BY created_at ASC`,
      [accreditationId],
    );

    return {
      accreditation,
      profile: profileRows[0] ?? null,
      business: businessRows[0] ?? null,
      evidence: evidenceRows,
      checkResults: checkResultRows,
      decisions,
    };
  });
}

export type OutstandingItemsResult = { rulesetConfigured: true; items: OutstandingRequirement[] } | { rulesetConfigured: false };

/**
 * The concrete fulfilment of Epic 9's deferred promise: threads the accreditation's
 * resolved ruleset_version_id through to computeOutstandingRequirements, building the
 * Fact from the broker's actual current data — NOT document-catalog.ts's hardcoded
 * catalog, which stays untouched and keeps serving everything outside an
 * accreditation's context.
 */
export async function getOutstandingItems(ctx: AuthorizationContext, accreditationId: string): Promise<OutstandingItemsResult> {
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);
    if (!accreditation.ruleset_version_id) return { rulesetConfigured: false };

    // ruleset_versions_visibility has no broker branch (Epic 9: brokers never read raw
    // ruleset JSON) — this function's whole point is letting a broker see their own
    // COMPUTED outstanding items without exposing the ruleset itself, so the read is
    // done under a transaction-local 'system' escalation, restored immediately after,
    // same mechanism flagPartyChanged uses below.
    await client.query(`SELECT set_config('app.actor_type', 'system', true)`);
    const { rows: rulesetRows } = await client.query(`SELECT definition FROM ruleset_versions WHERE id = $1`, [accreditation.ruleset_version_id]);
    await client.query(`SELECT set_config('app.actor_type', $1, true)`, [ctx.actorType]);
    if (!rulesetRows[0]) return { rulesetConfigured: false };

    const { rows: profileRows } = await client.query(`SELECT experience_years FROM broker_profiles WHERE id = $1`, [accreditation.broker_profile_id]);
    const experienceYears = profileRows[0]?.experience_years === null || profileRows[0]?.experience_years === undefined
      ? null
      : Number(profileRows[0].experience_years);

    const { rows: documentRows } = await client.query(
      `SELECT document_type FROM evidence
       WHERE ((subject_type = 'broker_profile' AND subject_id = $1) OR (subject_type = 'broker_business' AND subject_id = $2))
         AND valid_to IS NULL AND document_type IS NOT NULL`,
      [accreditation.broker_profile_id, accreditation.broker_business_id],
    );
    const documentTypes = new Set(documentRows.map((r) => r.document_type as string));

    const { rows: membershipRows } = await client.query(
      `SELECT 1 FROM association_memberships WHERE broker_profile_id = $1 LIMIT 1`,
      [accreditation.broker_profile_id],
    );

    const fact: Fact = {
      experienceYears,
      hasDocument: (documentType: string) => documentTypes.has(documentType),
      hasActiveAssociationMembership: membershipRows.length > 0,
    };

    const definition = rulesetRows[0].definition;
    const items = [
      ...computeOutstandingRequirements(definition, 'broker_profile' as SubjectType, fact),
      ...computeOutstandingRequirements(definition, 'broker_business' as SubjectType, fact),
    ];
    return { rulesetConfigured: true, items };
  });
}

async function getBrokerEmail(client: PoolClient, brokerProfileId: string): Promise<string> {
  const { rows } = await client.query(`SELECT email FROM broker_profiles WHERE id = $1`, [brokerProfileId]);
  return rows[0].email as string;
}

async function insertDecision(
  client: PoolClient,
  ctx: AuthorizationContext,
  accreditationId: string,
  decisionType: AccreditationDecision['decision_type'],
  extra: { rationale?: string | null; itemisedReasons?: string[] | null } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO accreditation_decisions (accreditation_id, actor_type, actor_id, decision_type, rationale, itemised_reasons)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      accreditationId,
      ctx.actorType,
      actorIdOf(ctx) ?? null,
      decisionType,
      extra.rationale ?? null,
      extra.itemisedReasons ? JSON.stringify(extra.itemisedReasons) : null,
    ],
  );
}

/** REV-003: itemised reasons, not a vague "more info needed." */
export async function requestMoreInformation(
  ctx: AuthorizationContext,
  accreditationId: string,
  itemisedReasons: string[],
): Promise<{ brokerEmail: string }> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);
    assertNotTerminal(accreditation, 'request information on');

    await client.query(`UPDATE accreditations SET status = 'information_required', updated_at = now() WHERE id = $1`, [accreditationId]);
    await insertDecision(client, ctx, accreditationId, 'information_requested', { itemisedReasons });
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.information_requested',
      subjectType: 'accreditation',
      subjectId: accreditationId,
      clientOrganisationId: accreditation.lender_client_organisation_id,
      detail: { itemisedReasons },
    });
    return { brokerEmail: await getBrokerEmail(client, accreditation.broker_profile_id) };
  });
}

/** W3 step 4: "Exceptions route to a senior approver." REV-006's Release-1 shape. */
export async function escalate(ctx: AuthorizationContext, accreditationId: string, rationale?: string): Promise<void> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);
    assertNotTerminal(accreditation, 'escalate');

    await client.query(
      `UPDATE accreditations SET status = 'exception_escalated', current_decision_step = 'senior_approver', updated_at = now() WHERE id = $1`,
      [accreditationId],
    );
    await insertDecision(client, ctx, accreditationId, 'escalated', { rationale });
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.escalated',
      subjectType: 'accreditation',
      subjectId: accreditationId,
      clientOrganisationId: accreditation.lender_client_organisation_id,
      detail: { rationale: rationale ?? null },
    });
  });
}

/**
 * REV-004/006: at the 'reviewer' step any client_user of the org may decide; at the
 * 'senior_approver' step (reached via escalate()) only that role may. The role is
 * re-derived from client_users here, not trusted from the request — the same "derive
 * from stored data, not from what the caller claims" reasoning RLS itself already
 * applies everywhere else.
 */
async function assertCanDecide(client: PoolClient, ctx: AuthorizationContext, accreditation: Accreditation): Promise<void> {
  if (accreditation.current_decision_step !== 'senior_approver') return;
  if (ctx.actorType !== 'client_user') throw new InsufficientRoleError('only a senior_approver may act at this decision step');
  const role = await getClientUserRole(client, ctx.actorId);
  if (role !== 'senior_approver') throw new InsufficientRoleError('only a senior_approver may act at this decision step');
}

/** approve stops at 'pending' — reaching 'active' is TRN-006, Epic 11's job, not this one's. */
export async function approve(ctx: AuthorizationContext, accreditationId: string, rationale?: string): Promise<{ brokerEmail: string }> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);
    if (accreditation.status !== 'requested' && accreditation.status !== 'exception_escalated') {
      throw new InvalidAccreditationTransitionError(accreditation.status, 'approve');
    }
    await assertCanDecide(client, ctx, accreditation);

    await client.query(`UPDATE accreditations SET status = 'pending', decided_at = now(), updated_at = now() WHERE id = $1`, [accreditationId]);
    await insertDecision(client, ctx, accreditationId, 'approved', { rationale });
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.approved',
      subjectType: 'accreditation',
      subjectId: accreditationId,
      clientOrganisationId: accreditation.lender_client_organisation_id,
      detail: { rationale: rationale ?? null },
    });
    return { brokerEmail: await getBrokerEmail(client, accreditation.broker_profile_id) };
  });
}

export async function decline(ctx: AuthorizationContext, accreditationId: string, rationale: string): Promise<{ brokerEmail: string }> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);
    if (accreditation.status !== 'requested' && accreditation.status !== 'exception_escalated') {
      throw new InvalidAccreditationTransitionError(accreditation.status, 'decline');
    }
    await assertCanDecide(client, ctx, accreditation);

    await client.query(`UPDATE accreditations SET status = 'declined', decided_at = now(), updated_at = now() WHERE id = $1`, [accreditationId]);
    await insertDecision(client, ctx, accreditationId, 'declined', { rationale });
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.declined',
      subjectType: 'accreditation',
      subjectId: accreditationId,
      clientOrganisationId: accreditation.lender_client_organisation_id,
      detail: { rationale },
    });
    return { brokerEmail: await getBrokerEmail(client, accreditation.broker_profile_id) };
  });
}

/** REV-005. */
export async function recordInterviewOutcome(
  ctx: AuthorizationContext,
  accreditationId: string,
  recommendation: string,
  notes?: string,
): Promise<void> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);
    assertNotTerminal(accreditation, 'record an interview outcome for');

    await client.query(`UPDATE accreditations SET interview_recommendation = $2, updated_at = now() WHERE id = $1`, [accreditationId, recommendation]);
    await insertDecision(client, ctx, accreditationId, 'interview_recorded', { rationale: notes ?? recommendation });
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.interview_recorded',
      subjectType: 'accreditation',
      subjectId: accreditationId,
      clientOrganisationId: accreditation.lender_client_organisation_id,
      detail: { recommendation, notes: notes ?? null },
    });
  });
}

/**
 * ACR-013: "a change to any of the four parties flags the accreditation for lender
 * action... flagged, not suspended." Takes an already-open client rather than opening
 * its own transaction, so businesses.repository.ts's endAffiliation can call this as a
 * final step of the SAME transaction that ends the affiliation — one atomic write, not
 * two. Every non-declined accreditation held through this (broker, business) pair is
 * flagged; ACR-014's per-lender-configurable automatic response is not built (see the
 * Epic 10 plan's Scope decision) — every flagged accreditation just waits for manual
 * reviewer action.
 *
 * The triggering ctx is usually a broker ending their own affiliation, and
 * accreditations_update's RLS policy deliberately has no broker branch (decisions are
 * lender-side only) — this flag isn't a "decision," it's a system-level side effect of
 * the broker's own action, so the UPDATE runs under a transaction-local 'system'
 * escalation (SET LOCAL, same mechanism withAuthorizationContext itself uses) and
 * restores the original session vars immediately after, so anything else running
 * later in the same transaction is unaffected. The audit trail still attributes the
 * event to the real ctx, not to 'system'.
 */
export async function flagPartyChanged(
  client: PoolClient,
  ctx: AuthorizationContext,
  brokerProfileId: string,
  brokerBusinessId: string,
  reason: string,
): Promise<string[]> {
  await client.query(`SELECT set_config('app.actor_type', 'system', true)`);
  const { rows } = await client.query<{ id: string }>(
    `UPDATE accreditations
     SET status = 'party_changed_pending', party_changed_at = now(), updated_at = now()
     WHERE broker_profile_id = $1 AND broker_business_id = $2 AND status NOT IN ('declined', 'party_changed_pending')
     RETURNING id`,
    [brokerProfileId, brokerBusinessId],
  );
  await client.query(`SELECT set_config('app.actor_type', $1, true)`, [ctx.actorType]);
  for (const row of rows) {
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.party_changed',
      subjectType: 'accreditation',
      subjectId: row.id,
      detail: { reason },
    });
  }
  return rows.map((r) => r.id);
}
