/**
 * RLS proof for training_confirmations: a broker can read their own accreditation's
 * confirmations but cannot create one (only the lender ever confirms — no broker
 * branch on the insert policy at all); a different lender's client_user sees nothing.
 */
import { pool } from '../../src/db/pool';
import { registerBroker, createClientOrganisation } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';
import { requestAccreditation, approve } from '../../src/modules/accreditation/accreditation.repository';
import { confirmTraining, listConfirmations } from '../../src/modules/accreditation/training.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({ email: `training-rls-${suffix}@example.com`, password: 'dev-password-123456', firstName: 'Training', lastName: 'RLS' });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function seedLender(suffix: string) {
  const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Training RLS Lender ${suffix}` });
  return { org, ctx: { actorType: 'client_user' as const, actorId: '00000000-0000-0000-0000-000000000000', clientOrganisationId: org.id } };
}

async function approvedAccreditation(brokerCtx: { actorType: 'broker'; actorId: string }, lender: { org: { id: string }; ctx: { actorType: 'client_user'; actorId: string; clientOrganisationId: string } }, suffix: string) {
  const business = await createBusiness(brokerCtx, brokerCtx.actorId, { entityType: 'company', legalName: `Training RLS Co ${suffix}` });
  await requestRelationship(brokerCtx, { brokerProfileId: brokerCtx.actorId, clientOrganisationId: lender.org.id, type: 'lender_panel', consentVersion: 'v1' });
  const { id } = await requestAccreditation(brokerCtx, {
    brokerProfileId: brokerCtx.actorId,
    lenderClientOrganisationId: lender.org.id,
    brokerBusinessId: business.id,
    classification: 'new_broker_introducer',
    brand: 'default',
    role: 'broker',
    productScope: 'commercial',
    licenceHolderType: 'broking_business',
    licenceHolderBrokerBusinessId: business.id,
  });
  await approve(lender.ctx, id, 'looks fine');
  return id;
}

describe('training_confirmations RLS (migration 0025)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a broker can read their own accreditation\'s confirmations but cannot create one', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const lender = await seedLender(suffix);
    const accreditationId = await approvedAccreditation(broker.ctx, lender, suffix);

    await confirmTraining(lender.ctx, accreditationId, 'platform', 'done via the lender\'s own LMS');

    const asBroker = await listConfirmations(broker.ctx, accreditationId);
    expect(asBroker.map((c) => c.kind)).toEqual(['platform']);

    await expect(confirmTraining(broker.ctx, accreditationId, 'product')).rejects.toThrow();
  });

  it('a different lender\'s client_user sees nothing for this accreditation', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const linked = await seedLender(`${suffix}-linked`);
    const stranger = await seedLender(`${suffix}-stranger`);
    const accreditationId = await approvedAccreditation(broker.ctx, linked, suffix);

    await confirmTraining(linked.ctx, accreditationId, 'platform');

    await expect(listConfirmations(stranger.ctx, accreditationId)).rejects.toThrow();
  });

  it('re-confirming the same kind is a harmless no-op, not an error', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const lender = await seedLender(suffix);
    const accreditationId = await approvedAccreditation(broker.ctx, lender, suffix);

    await confirmTraining(lender.ctx, accreditationId, 'platform', 'first confirmation');
    await confirmTraining(lender.ctx, accreditationId, 'platform', 'second attempt, should not duplicate');

    const confirmations = await listConfirmations(lender.ctx, accreditationId);
    expect(confirmations.filter((c) => c.kind === 'platform')).toHaveLength(1);
  });
});
