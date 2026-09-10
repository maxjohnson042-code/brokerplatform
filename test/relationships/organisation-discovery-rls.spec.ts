/**
 * REL-001 ("search for and select the lenders, aggregators and associations I want
 * to link to") — migration 0029's new broker-wide RLS branch on
 * client_organisations_visibility. Direct-repository style, same pattern as
 * visibility-resolution-rls.spec.ts.
 */
import { pool } from '../../src/db/pool';
import { registerBroker, createClientOrganisation, verifyClientOrganisation } from '../../src/modules/identity/identity.repository';
import {
  requestRelationship,
  listOrganisationsForDiscovery,
  listMyRelationships,
} from '../../src/modules/relationships/relationships.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `org-discovery-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Test',
    lastName: 'Broker',
  });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

describe('client_organisations broker discovery (migration 0029)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a broker cannot see an unverified organisation, and can see a verified one', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-a`);
    const unverified = await createClientOrganisation(systemCtx, { type: 'lender', name: `Unverified Lender ${suffix}` });
    const verified = await createClientOrganisation(systemCtx, { type: 'lender', name: `Verified Lender ${suffix}` });
    await verifyClientOrganisation(systemCtx, verified.id);

    const discoverable = await listOrganisationsForDiscovery(broker.ctx);
    const ids = discoverable.map((o) => o.id);
    expect(ids).not.toContain(unverified.id);
    expect(ids).toContain(verified.id);
  });

  it('the type filter only returns organisations of that type', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-b`);
    const lender = await createClientOrganisation(systemCtx, { type: 'lender', name: `Type Filter Lender ${suffix}` });
    const aggregator = await createClientOrganisation(systemCtx, { type: 'aggregator', name: `Type Filter Aggregator ${suffix}` });
    await verifyClientOrganisation(systemCtx, lender.id);
    await verifyClientOrganisation(systemCtx, aggregator.id);

    const aggregatorsOnly = await listOrganisationsForDiscovery(broker.ctx, 'aggregator');
    const ids = aggregatorsOnly.map((o) => o.id);
    expect(ids).toContain(aggregator.id);
    expect(ids).not.toContain(lender.id);
  });

  it('discover -> request -> the relationship appears active immediately, for an aggregator specifically', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-c`);
    const aggregator = await createClientOrganisation(systemCtx, { type: 'aggregator', name: `Discover Aggregator ${suffix}` });
    await verifyClientOrganisation(systemCtx, aggregator.id);

    const discoverable = await listOrganisationsForDiscovery(broker.ctx, 'aggregator');
    expect(discoverable.map((o) => o.id)).toContain(aggregator.id);

    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.broker.id,
      clientOrganisationId: aggregator.id,
      type: 'aggregator_membership',
      consentVersion: 'v1',
    });

    const relationships = await listMyRelationships(broker.ctx, broker.broker.id);
    const withAggregator = relationships.find((r) => r.client_organisation_id === aggregator.id);
    expect(withAggregator?.status).toBe('active');
    expect(withAggregator?.type).toBe('aggregator_membership');
  });
});
