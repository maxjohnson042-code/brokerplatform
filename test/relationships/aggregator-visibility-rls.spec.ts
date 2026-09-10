/**
 * Migration 0030's new RLS branches: a lender may see a broker-on-their-panel's
 * AGGREGATOR relationship (which aggregator they come through) and the aggregator
 * organisation's own name/logo, but must NEVER see that same broker's relationship
 * with a DIFFERENT LENDER. Direct-repository style, mirroring
 * test/relationships/visibility-resolution-rls.spec.ts.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import { requestRelationship, listOrganisationRelationships } from '../../src/modules/relationships/relationships.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `agg-rls-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Test',
    lastName: 'Broker',
  });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function seedOrg(suffix: string, type: 'lender' | 'aggregator') {
  const org = await createClientOrganisation(systemCtx, { type, name: `Agg RLS ${type} ${suffix}` });
  const user = await createClientUser(systemCtx, {
    clientOrganisationId: org.id,
    email: `agg-rls-reviewer-${suffix}@example.com`,
    password: 'dev-password-123456',
    role: 'reviewer',
  });
  return { org, ctx: { actorType: 'client_user' as const, actorId: user.id, clientOrganisationId: org.id } };
}

describe('aggregator visibility row-level security (migration 0030)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it("a lender sees a panel broker's aggregator relationship, but not the same broker's relationship with a DIFFERENT lender", async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const lenderA = await seedOrg(`${suffix}-a`, 'lender');
    const lenderB = await seedOrg(`${suffix}-b`, 'lender');
    const aggregator = await seedOrg(`${suffix}-agg`, 'aggregator');

    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.broker.id,
      clientOrganisationId: lenderA.org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });
    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.broker.id,
      clientOrganisationId: lenderB.org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });
    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.broker.id,
      clientOrganisationId: aggregator.org.id,
      type: 'aggregator_membership',
      consentVersion: 'v1',
    });

    // Lender A's own panel view sees the broker plus the aggregator's name — the new
    // LATERAL in listOrganisationRelationships.
    const asLenderA = await listOrganisationRelationships(lenderA.ctx, lenderA.org.id);
    expect(asLenderA).toHaveLength(1);
    expect(asLenderA[0].aggregator_organisation_name).toBe(`Agg RLS aggregator ${suffix}-agg`);

    // Raw relationships query as Lender A: sees its own row and the aggregator's row,
    // never Lender B's row.
    const rawAsLenderA = await withAuthorizationContext(lenderA.ctx, (client) =>
      client.query(`SELECT client_organisation_id, type FROM relationships WHERE broker_profile_id = $1 ORDER BY type`, [broker.broker.id]),
    );
    const seenOrgIds = rawAsLenderA.rows.map((r) => r.client_organisation_id as string);
    expect(seenOrgIds).toContain(lenderA.org.id);
    expect(seenOrgIds).toContain(aggregator.org.id);
    expect(seenOrgIds).not.toContain(lenderB.org.id);

    // The aggregator's own client_organisations row (name/logo) is readable...
    const aggOrgAsLenderA = await withAuthorizationContext(lenderA.ctx, (client) =>
      client.query(`SELECT id FROM client_organisations WHERE id = $1`, [aggregator.org.id]),
    );
    expect(aggOrgAsLenderA.rows).toHaveLength(1);

    // ...but Lender B's own client_organisations row is not — the new branch must
    // never leak another LENDER, only the aggregator_membership counterparty.
    const lenderBOrgAsLenderA = await withAuthorizationContext(lenderA.ctx, (client) =>
      client.query(`SELECT id FROM client_organisations WHERE id = $1`, [lenderB.org.id]),
    );
    expect(lenderBOrgAsLenderA.rows).toHaveLength(0);
  });
});
