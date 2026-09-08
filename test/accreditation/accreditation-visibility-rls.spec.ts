/**
 * RLS proof: a broker sees their own accreditation, not another broker's; a lender
 * sees its own org's queue, not another lender's; a broker attempting a decision
 * action is rejected outright (no client_user role at all — that's a guard-level
 * rejection, not RLS, but proven here for completeness). ACR-013's actual proof:
 * ending a business affiliation flags every accreditation held through that business.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation } from '../../src/modules/identity/identity.repository';
import { createBusiness, requestAffiliation, confirmAffiliation, endAffiliation } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';
import {
  requestAccreditation,
  listQueue,
  listMine,
  approve,
  InsufficientRoleError,
} from '../../src/modules/accreditation/accreditation.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `accr-rls-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Accr',
    lastName: 'RLS',
  });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function seedLender(suffix: string) {
  const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Accr RLS Lender ${suffix}` });
  return { org, ctx: { actorType: 'client_user' as const, actorId: '00000000-0000-0000-0000-000000000000', clientOrganisationId: org.id } };
}

async function fullyOnboard(brokerCtx: { actorType: 'broker'; actorId: string }, lenderId: string, suffix: string) {
  const business = await createBusiness(brokerCtx, brokerCtx.actorId, { entityType: 'company', legalName: `Accr RLS Co ${suffix}` });
  await requestRelationship(brokerCtx, {
    brokerProfileId: brokerCtx.actorId,
    clientOrganisationId: lenderId,
    type: 'lender_panel',
    consentVersion: 'v1',
  });
  const { id } = await requestAccreditation(brokerCtx, {
    brokerProfileId: brokerCtx.actorId,
    lenderClientOrganisationId: lenderId,
    brokerBusinessId: business.id,
    classification: 'new_broker_introducer',
    brand: 'default',
    role: 'broker',
    productScope: 'commercial',
    licenceHolderType: 'broking_business',
    licenceHolderBrokerBusinessId: business.id,
  });
  return { business, accreditationId: id };
}

describe('accreditation visibility and RLS (migration 0024)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a broker sees their own accreditation but not another broker\'s', async () => {
    const suffix = Date.now().toString();
    const brokerA = await seedBroker(`${suffix}-a`);
    const brokerB = await seedBroker(`${suffix}-b`);
    const lender = await seedLender(`${suffix}-shared`);

    const { accreditationId } = await fullyOnboard(brokerA.ctx, lender.org.id, `${suffix}-a`);

    const ownList = await listMine(brokerA.ctx, brokerA.broker.id);
    expect(ownList.map((a) => a.id)).toContain(accreditationId);

    const otherList = await listMine(brokerB.ctx, brokerB.broker.id);
    expect(otherList.map((a) => a.id)).not.toContain(accreditationId);
  });

  it('a lender sees its own organisation\'s queue, not another lender\'s', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-c`);
    const linked = await seedLender(`${suffix}-c-linked`);
    const stranger = await seedLender(`${suffix}-c-stranger`);

    const { accreditationId } = await fullyOnboard(broker.ctx, linked.org.id, `${suffix}-c`);

    const linkedQueue = await listQueue(linked.ctx, linked.org.id);
    expect(linkedQueue.map((a) => a.id)).toContain(accreditationId);

    const strangerQueue = await listQueue(stranger.ctx, stranger.org.id);
    expect(strangerQueue.map((a) => a.id)).not.toContain(accreditationId);
  });

  it('a broker (no client_user role at all) cannot approve', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-d`);
    const lender = await seedLender(`${suffix}-d`);
    const { accreditationId } = await fullyOnboard(broker.ctx, lender.org.id, `${suffix}-d`);

    await expect(approve(broker.ctx, accreditationId, 'self-approval attempt')).rejects.toThrow();
  });

  it('only senior_approver may approve once escalated — re-derived from the database, not trusted from the caller', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-e`);
    const lender = await seedLender(`${suffix}-e`);
    const { accreditationId } = await fullyOnboard(broker.ctx, lender.org.id, `${suffix}-e`);

    await withAuthorizationContext(systemCtx, (client) =>
      client.query(`UPDATE accreditations SET status = 'exception_escalated', current_decision_step = 'senior_approver' WHERE id = $1`, [
        accreditationId,
      ]),
    );

    await expect(approve(lender.ctx, accreditationId, 'not actually a senior approver')).rejects.toThrow(InsufficientRoleError);
  });

  it('ACR-013: ending a business affiliation flags every accreditation held through that business as party_changed_pending', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-f-founder`);
    const joiner = await seedBroker(`${suffix}-f-joiner`);
    const lenderA = await seedLender(`${suffix}-f-a`);
    const lenderB = await seedLender(`${suffix}-f-b`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: `Accr Party Co ${suffix}` });
    await withAuthorizationContext(systemCtx, (client) => client.query(`UPDATE broker_businesses SET status = 'verified' WHERE id = $1`, [business.id]));
    const pending = await requestAffiliation(joiner.ctx, joiner.broker.id, business.id);
    await confirmAffiliation(founder.ctx, founder.broker.id, business.id, pending.id);

    await requestRelationship(joiner.ctx, { brokerProfileId: joiner.broker.id, clientOrganisationId: lenderA.org.id, type: 'lender_panel', consentVersion: 'v1' });
    await requestRelationship(joiner.ctx, { brokerProfileId: joiner.broker.id, clientOrganisationId: lenderB.org.id, type: 'lender_panel', consentVersion: 'v1' });

    const accrA = await requestAccreditation(joiner.ctx, {
      brokerProfileId: joiner.broker.id,
      lenderClientOrganisationId: lenderA.org.id,
      brokerBusinessId: business.id,
      classification: 'new_broker_introducer',
      brand: 'default',
      role: 'broker',
      productScope: 'commercial',
      licenceHolderType: 'broking_business',
      licenceHolderBrokerBusinessId: business.id,
    });
    const accrB = await requestAccreditation(joiner.ctx, {
      brokerProfileId: joiner.broker.id,
      lenderClientOrganisationId: lenderB.org.id,
      brokerBusinessId: business.id,
      classification: 'new_broker_introducer',
      brand: 'default',
      role: 'broker',
      productScope: 'equipment_finance',
      licenceHolderType: 'broking_business',
      licenceHolderBrokerBusinessId: business.id,
    });

    await endAffiliation(joiner.ctx, joiner.broker.id, pending.id, 'moving on');

    const afterA = await withAuthorizationContext(systemCtx, (client) => client.query(`SELECT status FROM accreditations WHERE id = $1`, [accrA.id]));
    const afterB = await withAuthorizationContext(systemCtx, (client) => client.query(`SELECT status FROM accreditations WHERE id = $1`, [accrB.id]));
    expect(afterA.rows[0].status).toBe('party_changed_pending');
    expect(afterB.rows[0].status).toBe('party_changed_pending');
  });
});
