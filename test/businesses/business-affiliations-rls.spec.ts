/**
 * Proves migration 0019's RLS: the new business_principals/business_affiliations
 * policies, AND — the specific gap this epic closes — that a merely PENDING
 * affiliation grants no visibility into the business at all, unlike before this epic
 * (broker_businesses_visibility/update used to key off `ended_at IS NULL`, which a
 * pending row also satisfies). Calls the repository layer directly, same style as
 * test/identity/client-user-provisioning-rls.spec.ts and
 * test/brokers/association-memberships-rls.spec.ts.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker } from '../../src/modules/identity/identity.repository';
import {
  createBusiness,
  requestAffiliation,
  confirmAffiliation,
  getBusiness,
  listBusinessAffiliations,
  addPrincipal,
  listPrincipals,
  NotAffiliatedError,
} from '../../src/modules/businesses/businesses.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `biz-rls-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Test',
    lastName: 'Broker',
  });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function markVerified(businessId: string) {
  await withAuthorizationContext(systemCtx, (client) =>
    client.query(`UPDATE broker_businesses SET status = 'verified' WHERE id = $1`, [businessId]),
  );
}

describe('business_affiliations / business_principals row-level security (migration 0019)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a broker with no affiliation cannot see the business at all', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const outsider = await seedBroker(`${suffix}-outsider`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'Acme Co' });

    const asOutsider = await getBusiness(outsider.ctx, business.id);
    expect(asOutsider).toBeNull();

    const asFounder = await getBusiness(founder.ctx, business.id);
    expect(asFounder).not.toBeNull();
  });

  it('a PENDING (unconfirmed) affiliation grants no visibility — the specific gap this epic closes', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const joiner = await seedBroker(`${suffix}-joiner`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'Beta Co' });
    await markVerified(business.id);

    await requestAffiliation(joiner.ctx, joiner.broker.id, business.id);

    // Before this epic's fix, ended_at IS NULL was true for a pending row too, so this
    // would incorrectly return the business. It must not.
    const asJoinerBeforeConfirm = await getBusiness(joiner.ctx, business.id);
    expect(asJoinerBeforeConfirm).toBeNull();
  });

  it('confirmation by an active co-principal flips the affiliation and grants visibility', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const joiner = await seedBroker(`${suffix}-joiner`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'Gamma Co' });
    await markVerified(business.id);
    const pending = await requestAffiliation(joiner.ctx, joiner.broker.id, business.id);

    // The founder (active) can see the pending row via listBusinessAffiliations even
    // though it isn't their own row — the has_active_business_affiliation() branch.
    const affiliations = await listBusinessAffiliations(founder.ctx, business.id);
    expect(affiliations.map((a) => a.id)).toContain(pending.id);

    await confirmAffiliation(founder.ctx, founder.broker.id, business.id, pending.id);

    const asJoinerAfterConfirm = await getBusiness(joiner.ctx, business.id);
    expect(asJoinerAfterConfirm).not.toBeNull();
  });

  it('a broker with only a pending request has no standing to confirm anything for that business — including their own request', async () => {
    // Note: this exercises NotAffiliatedError, not CannotConfirmOwnAffiliationError —
    // the joiner's own affiliation is 'pending_confirmation', not 'active', so they
    // fail the "do you have standing here at all" check before the "is this your own
    // row" check is ever reached. CannotConfirmOwnAffiliationError is a defensive
    // second guard for an already-active broker somehow holding a stray pending row
    // for the same business — not reachable through requestAffiliation's own
    // duplicate-request check in normal use, so it isn't separately exercised here.
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const joiner = await seedBroker(`${suffix}-joiner`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'Delta Co' });
    await markVerified(business.id);
    const pending = await requestAffiliation(joiner.ctx, joiner.broker.id, business.id);

    await expect(confirmAffiliation(joiner.ctx, joiner.broker.id, business.id, pending.id)).rejects.toThrow(
      NotAffiliatedError,
    );
  });

  it('a broker with an active affiliation to business X cannot see business Y\'s principals', async () => {
    const suffix = Date.now().toString();
    const ownerX = await seedBroker(`${suffix}-x`);
    const ownerY = await seedBroker(`${suffix}-y`);

    const businessX = await createBusiness(ownerX.ctx, ownerX.broker.id, { entityType: 'company', legalName: 'X Co' });
    const businessY = await createBusiness(ownerY.ctx, ownerY.broker.id, { entityType: 'company', legalName: 'Y Co' });
    await addPrincipal(ownerY.ctx, ownerY.broker.id, businessY.id, { role: 'director', firstName: 'Y', lastName: 'Principal' });

    // Raw query as ownerX, bypassing listPrincipals' own filtering, to prove RLS itself
    // (not just the repository's WHERE clause) blocks the cross-business read.
    const raw = await withAuthorizationContext(ownerX.ctx, (client) =>
      client.query(`SELECT id FROM business_principals WHERE broker_business_id = $1`, [businessY.id]),
    );
    expect(raw.rows).toHaveLength(0);

    const ownPrincipals = await listPrincipals(ownerY.ctx, businessY.id);
    expect(ownPrincipals).toHaveLength(1);
  });
});
