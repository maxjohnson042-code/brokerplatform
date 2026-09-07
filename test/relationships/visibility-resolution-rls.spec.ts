/**
 * Epic 8's "first-class, exhaustively tested" visibility-resolution proof
 * (Release 1 Backlog §8). Covers three things migration 0021/0022 changed:
 *
 * 1. relationships itself now has RLS (previously none at all).
 * 2. has_active_relationship() correctly gates broker_profiles — a PENDING
 *    (not-yet-accepted) relationship grants no visibility, only an active one does.
 * 3. check_result's business-subject branch — the THIRD occurrence of the
 *    ba.ended_at-vs-status bug (already fixed twice in Epics 4/5, missed here both
 *    times) — now correctly excludes a business whose only affiliated broker has a
 *    merely pending, not active, business affiliation, even when that broker
 *    separately has an active *relationship* with the querying client.
 *
 * Direct-repository style, mirroring test/businesses/business-affiliations-rls.spec.ts
 * and test/evidence/evidence-visibility-rls.spec.ts.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import { createBusiness, requestAffiliation, confirmAffiliation } from '../../src/modules/businesses/businesses.repository';
import {
  requestRelationship,
  inviteBroker,
  listMyRelationships,
} from '../../src/modules/relationships/relationships.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `rel-rls-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Test',
    lastName: 'Broker',
  });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function seedLender(suffix: string) {
  const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `RLS Lender ${suffix}` });
  const user = await createClientUser(systemCtx, {
    clientOrganisationId: org.id,
    email: `rel-rls-reviewer-${suffix}@example.com`,
    password: 'dev-password-123456',
    role: 'reviewer',
  });
  return { org, ctx: { actorType: 'client_user' as const, actorId: user.id, clientOrganisationId: org.id } };
}

describe('relationships row-level security and visibility resolution (migration 0021/0022)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a client with an active relationship sees the broker profile; an unrelated client and a merely-invited-but-not-accepted client do not', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-a`);
    const linked = await seedLender(`${suffix}-linked`);
    const unrelated = await seedLender(`${suffix}-unrelated`);
    const inviter = await seedLender(`${suffix}-inviter`);

    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.broker.id,
      clientOrganisationId: linked.org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });
    await inviteBroker(inviter.ctx, {
      clientOrganisationId: inviter.org.id,
      brokerEmail: `rel-rls-${suffix}-a@example.com`,
      type: 'lender_panel',
    });

    const asLinked = await withAuthorizationContext(linked.ctx, (client) =>
      client.query(`SELECT id FROM broker_profiles WHERE id = $1`, [broker.broker.id]),
    );
    expect(asLinked.rows).toHaveLength(1);

    const asUnrelated = await withAuthorizationContext(unrelated.ctx, (client) =>
      client.query(`SELECT id FROM broker_profiles WHERE id = $1`, [broker.broker.id]),
    );
    expect(asUnrelated.rows).toHaveLength(0);

    // Pending (invited, not yet accepted) grants no more than an unrelated client gets.
    const asInviterPending = await withAuthorizationContext(inviter.ctx, (client) =>
      client.query(`SELECT id FROM broker_profiles WHERE id = $1`, [broker.broker.id]),
    );
    expect(asInviterPending.rows).toHaveLength(0);
  });

  it('a broker sees the client organisation\'s own row even while only pending — migration 0022\'s fix', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-b`);
    const inviter = await seedLender(`${suffix}-b-inviter`);
    const stranger = await seedLender(`${suffix}-b-stranger`);

    await inviteBroker(inviter.ctx, {
      clientOrganisationId: inviter.org.id,
      brokerEmail: `rel-rls-${suffix}-b@example.com`,
      type: 'lender_panel',
    });

    const relationships = await listMyRelationships(broker.ctx, broker.broker.id);
    expect(relationships).toHaveLength(1);
    expect(relationships[0].client_organisation_name).toBe(`RLS Lender ${suffix}-b-inviter`);

    const asBroker = await withAuthorizationContext(broker.ctx, (client) =>
      client.query(`SELECT id FROM client_organisations WHERE id = $1`, [stranger.org.id]),
    );
    expect(asBroker.rows).toHaveLength(0);
  });

  it('check_result business branch: a merely-pending business affiliation grants no visibility even when the broker has an active RELATIONSHIP — the third ended_at-vs-status bug', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const joiner = await seedBroker(`${suffix}-joiner`);
    const lender = await seedLender(`${suffix}-cr`);

    const business = await createBusiness(founder.ctx, founder.broker.id, {
      entityType: 'company',
      legalName: 'RLS Check Result Co',
    });
    await withAuthorizationContext(systemCtx, (client) =>
      client.query(`UPDATE broker_businesses SET status = 'verified' WHERE id = $1`, [business.id]),
    );

    // joiner has an ACTIVE relationship with the lender...
    await requestRelationship(joiner.ctx, {
      brokerProfileId: joiner.broker.id,
      clientOrganisationId: lender.org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });
    // ...but only a PENDING affiliation to the business.
    const pending = await requestAffiliation(joiner.ctx, joiner.broker.id, business.id);

    const { rows: crRows } = await withAuthorizationContext(systemCtx, (client) =>
      client.query(
        `INSERT INTO check_result (subject_type, subject_id, check_type, provider, outcome)
         VALUES ('broker_business', $1, 'business_registration', 'manual', 'current') RETURNING id`,
        [business.id],
      ),
    );
    const checkResultId = crRows[0].id as string;

    // Before migration 0021, ba.ended_at IS NULL was true for this pending row too,
    // so this would incorrectly return the check result. It must not.
    const beforeConfirm = await withAuthorizationContext(lender.ctx, (client) =>
      client.query(`SELECT id FROM check_result WHERE id = $1`, [checkResultId]),
    );
    expect(beforeConfirm.rows).toHaveLength(0);

    await confirmAffiliation(founder.ctx, founder.broker.id, business.id, pending.id);

    const afterConfirm = await withAuthorizationContext(lender.ctx, (client) =>
      client.query(`SELECT id FROM check_result WHERE id = $1`, [checkResultId]),
    );
    expect(afterConfirm.rows).toHaveLength(1);
  });

  it('association_memberships: any relationship type sees membership standing, unrestricted by type — has_active_relationship(..., NULL)', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-assoc`);
    const association = await seedLender(`${suffix}-assoc-body`);

    await withAuthorizationContext(systemCtx, (client) =>
      client.query(
        `INSERT INTO association_memberships (broker_profile_id, association_name, membership_number)
         VALUES ($1, 'MFAA', 'MFAA-1')`,
        [broker.broker.id],
      ),
    );

    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.broker.id,
      clientOrganisationId: association.org.id,
      type: 'association_membership',
      consentVersion: 'v1',
    });

    const asAssociation = await withAuthorizationContext(association.ctx, (client) =>
      client.query(`SELECT id FROM association_memberships WHERE broker_profile_id = $1`, [broker.broker.id]),
    );
    expect(asAssociation.rows).toHaveLength(1);
  });
});
