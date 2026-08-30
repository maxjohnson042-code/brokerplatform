import { withAuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { recordMeteringEvent } from '../metering/metering.repository';

export type RelationshipType = 'lender_panel' | 'aggregator_membership' | 'association_membership';

const SHARED_DATA_SCOPE: Record<RelationshipType, string> = {
  lender_panel: 'lender_full',
  aggregator_membership: 'aggregator_full',
  association_membership: 'association_membership_only',
}; // Section 2.2: sharing scope varies by client TYPE, not by field

/**
 * REL-001/REL-002: broker-initiated relationship request with consent recorded at the
 * same moment — Section 2.2: "Consent is therefore a single, informed,
 * relationship-level decision." Runs as the broker actor.
 *
 * KNOWN GAP, left visible on purpose rather than quietly worked around: migration
 * 0007 does not yet ENABLE ROW LEVEL SECURITY on `relationships` itself — only on the
 * tables that reference it via subquery (broker_profiles, evidence, etc.). That means
 * this table currently relies on layer one (the AuthorizationContext boundary) alone,
 * with no layer-two backstop. Close this in Epic 8 alongside the visibility-resolution
 * service extraction — a broker or client_user should only ever see relationship rows
 * they are a party to.
 *
 * On activation this also emits a 'broker_linked' metering event (BIL-001) in the
 * SAME transaction — a relationship reaching 'active' is a billable event from day
 * one even though invoicing itself is out of scope for Release 1.
 */
export async function requestRelationship(input: {
  brokerProfileId: string;
  clientOrganisationId: string;
  type: RelationshipType;
  consentVersion: string;
}): Promise<{ id: string }> {
  return withAuthorizationContext(
    { actorType: 'broker', actorId: input.brokerProfileId },
    async (client) => {
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
    },
  );
}
