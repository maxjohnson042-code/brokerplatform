import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { recordMeteringEvent } from '../metering/metering.repository';
import { ClientOrganisationType } from '../identity/identity.repository';

export type RelationshipType = 'lender_panel' | 'aggregator_membership' | 'association_membership';

const SHARED_DATA_SCOPE: Record<RelationshipType, string> = {
  lender_panel: 'lender_full',
  aggregator_membership: 'aggregator_full',
  association_membership: 'association_membership_only',
}; // Section 2.2: sharing scope varies by client TYPE, not by field

export class RelationshipNotFoundError extends Error {
  constructor(id: string) {
    super(`relationship not found: ${id}`);
    this.name = 'RelationshipNotFoundError';
  }
}
export class InvalidRelationshipTransitionError extends Error {
  constructor(
    public readonly status: string,
    public readonly attempted: string,
  ) {
    super(`cannot ${attempted} a relationship while status is '${status}'`);
    this.name = 'InvalidRelationshipTransitionError';
  }
}
export class BrokerNotFoundError extends Error {
  constructor(email: string) {
    super(`no registered broker with email: ${email}`);
    this.name = 'BrokerNotFoundError';
  }
}

function actorIdOf(ctx: AuthorizationContext): string | undefined {
  return 'actorId' in ctx ? ctx.actorId : undefined;
}

/**
 * REL-001/REL-002: broker-initiated relationship request with consent recorded at the
 * same moment — Section 2.2: "Consent is therefore a single, informed,
 * relationship-level decision."
 *
 * `ctx` is explicit (rather than constructed internally from `brokerProfileId`, as
 * this function used to do) to match every repository function built since Epic 2 —
 * this was the one remaining holdout from before that convention existed.
 * `scripts/demo-tenancy.ts` is the only pre-existing caller and was updated alongside
 * this change.
 *
 * RLS on `relationships` itself, and the `has_active_relationship()` visibility
 * function every other table's policy now calls, are migration 0021 (Epic 8) — this
 * function's own doc comment used to flag both as a known, deliberately-visible gap;
 * they're closed now, not still open.
 *
 * On activation this also emits a 'broker_linked' metering event (BIL-001) in the
 * SAME transaction — a relationship reaching 'active' is a billable event from day
 * one even though invoicing itself is out of scope for Release 1.
 */
export async function requestRelationship(
  ctx: AuthorizationContext,
  input: {
    brokerProfileId: string;
    clientOrganisationId: string;
    type: RelationshipType;
    consentVersion: string;
  },
): Promise<{ id: string }> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO relationships
         (broker_profile_id, client_organisation_id, type, status, shared_data_scope,
          consented_at, consent_version, effective_from)
       VALUES ($1, $2, $3, 'active', $4, now(), $5, now())
       RETURNING id`,
      [
        input.brokerProfileId,
        input.clientOrganisationId,
        input.type,
        SHARED_DATA_SCOPE[input.type],
        input.consentVersion,
      ],
    );
    const id = rows[0].id as string;

    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: input.brokerProfileId,
      action: 'relationship.consented',
      subjectType: 'relationship',
      subjectId: id,
      clientOrganisationId: input.clientOrganisationId,
      detail: { type: input.type, consentVersion: input.consentVersion },
    });

    await recordMeteringEvent(client, {
      clientOrganisationId: input.clientOrganisationId,
      brokerProfileId: input.brokerProfileId,
      eventType: 'broker_linked',
    });

    return { id };
  });
}

/**
 * REL-001's other half: what a broker can actually search/select FROM, before any
 * relationship exists — migration 0029's new broker-wide RLS branch (verified_at IS
 * NOT NULL, status='active') is what makes this return anything at all. Deliberately
 * selects only id/name/type/logoUrl — never the full `settings` jsonb — matching that
 * migration's own comment: RLS grants row visibility, this function still decides
 * what of the row is exposed.
 */
export async function listOrganisationsForDiscovery(
  ctx: AuthorizationContext,
  type?: ClientOrganisationType,
): Promise<Array<{ id: string; name: string; type: ClientOrganisationType; logo_url: string | null }>> {
  return withAuthorizationContext(ctx, async (client) => {
    const params: unknown[] = [];
    let where = '';
    if (type) {
      params.push(type);
      where = `WHERE type = $${params.length}`;
    }
    const { rows } = await client.query(
      `SELECT id, name, type, settings->'branding'->>'logoUrl' AS logo_url
       FROM client_organisations
       ${where}
       ORDER BY name`,
      params,
    );
    return rows;
  });
}

/**
 * REL-003: client-initiated invitation. Scoped to already-registered brokers only —
 * inviting an email with no account yet would need a separate pending-invitation
 * table (and a notification to tell them to register), which is explicitly out of
 * scope for this pass, not silently half-built. The lookup runs as 'system': at
 * invite time there is no relationship yet, so broker_profiles_visibility would deny
 * the client_user's own ctx a look — same reasoning as the ABN Lookup / business
 * search patterns in Epic 4.
 *
 * Lands as `status = 'pending_acceptance'`, `consented_at` still NULL — only the
 * client's side has happened so far.
 */
export async function inviteBroker(
  ctx: AuthorizationContext,
  input: { clientOrganisationId: string; brokerEmail: string; type: RelationshipType },
): Promise<{ id: string }> {
  const brokerId = await withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id FROM broker_profiles WHERE email = $1`, [
      input.brokerEmail.toLowerCase(),
    ]);
    return rows[0]?.id as string | undefined;
  });
  if (!brokerId) throw new BrokerNotFoundError(input.brokerEmail);

  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO relationships (broker_profile_id, client_organisation_id, type, status, shared_data_scope)
       VALUES ($1, $2, $3, 'pending_acceptance', $4)
       RETURNING id`,
      [brokerId, input.clientOrganisationId, input.type, SHARED_DATA_SCOPE[input.type]],
    );
    const id = rows[0].id as string;

    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'relationship.invited',
      subjectType: 'relationship',
      subjectId: id,
      clientOrganisationId: input.clientOrganisationId,
      detail: { type: input.type, brokerProfileId: brokerId },
    });

    return { id };
  });
}

/** REL-004: broker accepts. Only valid from 'pending_acceptance' — the same shape requestRelationship's own INSERT uses for the resulting active row. */
export async function acceptInvitation(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  relationshipId: string,
  consentVersion: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT client_organisation_id, status FROM relationships WHERE id = $1 AND broker_profile_id = $2`,
      [relationshipId, brokerProfileId],
    );
    if (rows.length === 0) throw new RelationshipNotFoundError(relationshipId);
    if (rows[0].status !== 'pending_acceptance') {
      throw new InvalidRelationshipTransitionError(rows[0].status, 'accept');
    }

    await client.query(
      `UPDATE relationships
       SET status = 'active', consented_at = now(), consent_version = $2, effective_from = now()
       WHERE id = $1`,
      [relationshipId, consentVersion],
    );

    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'relationship.consented',
      subjectType: 'relationship',
      subjectId: relationshipId,
      clientOrganisationId: rows[0].client_organisation_id,
      detail: { consentVersion },
    });

    // Same billable event requestRelationship emits — a relationship becoming active
    // is equally billable regardless of which side initiated it.
    await recordMeteringEvent(client, {
      clientOrganisationId: rows[0].client_organisation_id,
      brokerProfileId,
      eventType: 'broker_linked',
    });
  });
}

/** REL-004: broker declines. Only valid from 'pending_acceptance'. */
export async function declineInvitation(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  relationshipId: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT client_organisation_id, status FROM relationships WHERE id = $1 AND broker_profile_id = $2`,
      [relationshipId, brokerProfileId],
    );
    if (rows.length === 0) throw new RelationshipNotFoundError(relationshipId);
    if (rows[0].status !== 'pending_acceptance') {
      throw new InvalidRelationshipTransitionError(rows[0].status, 'decline');
    }

    await client.query(`UPDATE relationships SET status = 'declined' WHERE id = $1`, [relationshipId]);

    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'relationship.declined',
      subjectType: 'relationship',
      subjectId: relationshipId,
      clientOrganisationId: rows[0].client_organisation_id,
    });
  });
}

/** REL-006: broker-initiated, reason optional ("with confirmation of the consequences" — a UI concern, not a backend one). Only valid from 'active'. */
export async function revokeRelationship(
  ctx: AuthorizationContext,
  brokerProfileId: string,
  relationshipId: string,
  reason?: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT client_organisation_id, status FROM relationships WHERE id = $1 AND broker_profile_id = $2`,
      [relationshipId, brokerProfileId],
    );
    if (rows.length === 0) throw new RelationshipNotFoundError(relationshipId);
    if (rows[0].status !== 'active') throw new InvalidRelationshipTransitionError(rows[0].status, 'revoke');

    await client.query(
      `UPDATE relationships SET status = 'revoked', effective_to = now(), end_reason = $2 WHERE id = $1`,
      [relationshipId, reason ?? null],
    );

    await recordAuditEvent(client, {
      actorType: 'broker',
      actorId: brokerProfileId,
      action: 'relationship.revoked',
      subjectType: 'relationship',
      subjectId: relationshipId,
      clientOrganisationId: rows[0].client_organisation_id,
      detail: { reason: reason ?? null },
    });
  });
}

/** REL-007: client-initiated, reason REQUIRED — the one place the master doc's own wording ("with reason recorded") distinguishes the two directions. Only valid from 'active'. */
export async function endRelationship(
  ctx: AuthorizationContext,
  clientUserId: string,
  clientOrganisationId: string,
  relationshipId: string,
  reason: string,
): Promise<void> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT status FROM relationships WHERE id = $1 AND client_organisation_id = $2`,
      [relationshipId, clientOrganisationId],
    );
    if (rows.length === 0) throw new RelationshipNotFoundError(relationshipId);
    if (rows[0].status !== 'active') throw new InvalidRelationshipTransitionError(rows[0].status, 'end');

    await client.query(
      `UPDATE relationships SET status = 'ended', effective_to = now(), end_reason = $2 WHERE id = $1`,
      [relationshipId, reason],
    );

    await recordAuditEvent(client, {
      actorType: 'client_user',
      actorId: clientUserId,
      action: 'relationship.ended',
      subjectType: 'relationship',
      subjectId: relationshipId,
      clientOrganisationId,
      detail: { reason },
    });
  });
}

/** REL-005: every relationship the broker has ever had, current and historical. LEFT JOIN: client_organisations_visibility (migration 0022) covers any status, so this should always resolve, but LEFT stays defensive rather than silently dropping a row a future policy change might exclude. */
export async function listMyRelationships(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.client_organisation_id, r.type, r.status, r.shared_data_scope, r.consented_at,
              r.effective_from, r.effective_to, r.end_reason, r.created_at,
              co.name AS client_organisation_name, co.type AS client_organisation_type,
              co.settings->'branding'->>'logoUrl' AS client_organisation_logo_url
       FROM relationships r
       LEFT JOIN client_organisations co ON co.id = r.client_organisation_id
       WHERE r.broker_profile_id = $1
       ORDER BY r.created_at DESC`,
      [brokerProfileId],
    );
    return rows;
  });
}

/**
 * App-layer half of the belt-and-braces check for the lender's-point-of-view broker
 * routes (client-broker-view.controller.ts) — RLS (migration 0021's
 * has_active_relationship) is the brace and already scopes every read those routes
 * make, but an unrelated brokerId should 403 explicitly rather than silently returning
 * empty results from five different endpoints. Runs under the caller's own ctx:
 * relationships itself has RLS scoping a client_user to their own org's rows
 * (migration 0021), so no separate clientOrganisationId parameter is needed here — a
 * client_user simply cannot see another org's relationship rows at all.
 */
export async function hasActiveRelationshipWithBroker(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<boolean> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM relationships
       WHERE broker_profile_id = $1 AND status = 'active' AND effective_to IS NULL
         AND type IN ('lender_panel', 'aggregator_membership')
       LIMIT 1`,
      [brokerProfileId],
    );
    return rows.length > 0;
  });
}

/**
 * The client-side symmetric view — not a numbered REL-* ticket itself, but required
 * for the invite/accept flow and REL-005's "one view" to be usable from the client
 * side too. LEFT JOIN broker_profiles: a broker with only a pending, not-yet-accepted
 * invitation isn't visible via broker_profiles_visibility yet (it requires an active
 * relationship) — the relationship row itself must still show, with the broker's name
 * columns null until they accept. Same pattern businesses.repository.ts's
 * listMyAffiliations already uses for the identical reason.
 *
 * Also carries the same review-relevant signal the queue's listQueue enriched with —
 * a bare name/status pair told a lender nothing about who they're actually looking at.
 * The business columns come from a LATERAL picking this broker's most recently
 * started ACTIVE affiliation (a broker can hold several; the panel shows one
 * representative business, not all of them — the full list is on the broker-profile
 * page's own Business affiliations card). The accreditation counts are a second
 * LATERAL rather than two separate scalar subqueries, scoped to THIS lender only via
 * r.client_organisation_id. The aggregator/association LATERALs added for the
 * dashboard's "mix" cards are broker-wide, not scoped to this lender — association
 * memberships were never lender-scoped to begin with, and the aggregator lookup is
 * deliberately the one broker-mediated cross-org read migration 0030 permits.
 */
export async function listOrganisationRelationships(
  ctx: AuthorizationContext,
  clientOrganisationId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.broker_profile_id, r.type, r.status, r.shared_data_scope, r.consented_at,
              r.effective_from, r.effective_to, r.end_reason, r.created_at,
              bp.first_name, bp.last_name, bp.email, bp.status AS broker_profile_status, bp.experience_years,
              biz.legal_name AS business_legal_name, biz.status AS business_status,
              (SELECT COUNT(*)::int FROM evidence e
                WHERE e.subject_type = 'broker_profile' AND e.subject_id = r.broker_profile_id
                  AND e.valid_to IS NULL AND e.document_type IS NOT NULL
              ) AS document_count,
              COALESCE(acc.accreditation_count, 0) AS accreditation_count,
              COALESCE(acc.active_accreditation_count, 0) AS active_accreditation_count,
              agg.org_name AS aggregator_organisation_name, agg.org_logo_url AS aggregator_organisation_logo_url,
              assoc.names AS association_names
       FROM relationships r
       LEFT JOIN broker_profiles bp ON bp.id = r.broker_profile_id
       LEFT JOIN LATERAL (
         SELECT bb.legal_name, bb.status
         FROM business_affiliations ba
         JOIN broker_businesses bb ON bb.id = ba.broker_business_id
         WHERE ba.broker_profile_id = r.broker_profile_id AND ba.status = 'active'
         ORDER BY ba.started_at DESC
         LIMIT 1
       ) biz ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS accreditation_count,
                COUNT(*) FILTER (WHERE a2.status = 'active')::int AS active_accreditation_count
         FROM accreditations a2
         WHERE a2.broker_profile_id = r.broker_profile_id AND a2.lender_client_organisation_id = r.client_organisation_id
       ) acc ON true
       -- Migration 0030: readable only because that migration's new RLS branches
       -- grant a client_user visibility into a DIFFERENT org's aggregator_membership
       -- relationship row (and that org's own id/name/logo) for a broker they already
       -- have an active relationship with — never a lender_panel row from elsewhere.
       LEFT JOIN LATERAL (
         SELECT r2.client_organisation_id AS org_id, co.name AS org_name,
                co.settings->'branding'->>'logoUrl' AS org_logo_url
         FROM relationships r2
         JOIN client_organisations co ON co.id = r2.client_organisation_id
         WHERE r2.broker_profile_id = r.broker_profile_id AND r2.type = 'aggregator_membership' AND r2.status = 'active'
         ORDER BY r2.created_at DESC
         LIMIT 1
       ) agg ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT am.association_name) AS names
         FROM association_memberships am
         WHERE am.broker_profile_id = r.broker_profile_id
       ) assoc ON true
       WHERE r.client_organisation_id = $1
       ORDER BY r.created_at DESC`,
      [clientOrganisationId],
    );
    return rows;
  });
}
