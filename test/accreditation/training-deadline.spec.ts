/**
 * TRN-008: an explicit, callable lapse check (not scheduled — see the Epic 11 plan's
 * Scope decision). An accreditation whose training_deadline_at is forced into the
 * past (direct DB write, same trick every prior temporal test uses) is lapsed; one
 * still within its deadline, or already active, is left untouched.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';
import { requestAccreditation, approve } from '../../src/modules/accreditation/accreditation.repository';
import { checkTrainingDeadlines, activateAccreditation } from '../../src/modules/accreditation/training.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({ email: `training-deadline-${suffix}@example.com`, password: 'dev-password-123456', firstName: 'Deadline', lastName: 'Test' });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function seedLender(suffix: string) {
  const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Training Deadline Lender ${suffix}` });
  return { org, ctx: { actorType: 'client_user' as const, actorId: '00000000-0000-0000-0000-000000000000', clientOrganisationId: org.id } };
}

async function approvedAccreditation(
  brokerCtx: { actorType: 'broker'; actorId: string },
  lender: { org: { id: string }; ctx: { actorType: 'client_user'; actorId: string; clientOrganisationId: string } },
  suffix: string,
  productScope = 'commercial',
) {
  const business = await createBusiness(brokerCtx, brokerCtx.actorId, { entityType: 'company', legalName: `Deadline Co ${suffix}` });
  await requestRelationship(brokerCtx, { brokerProfileId: brokerCtx.actorId, clientOrganisationId: lender.org.id, type: 'lender_panel', consentVersion: 'v1' });
  const { id } = await requestAccreditation(brokerCtx, {
    brokerProfileId: brokerCtx.actorId,
    lenderClientOrganisationId: lender.org.id,
    brokerBusinessId: business.id,
    classification: 'new_broker_introducer',
    brand: 'default',
    role: 'broker',
    productScope,
    licenceHolderType: 'broking_business',
    licenceHolderBrokerBusinessId: business.id,
  });
  await approve(lender.ctx, id, 'looks fine');
  return id;
}

describe('training deadline lapse (TRN-008)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('lapses a pending accreditation whose deadline has passed; leaves one still within its deadline untouched', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const lender = await seedLender(suffix);

    const overdueId = await approvedAccreditation(broker.ctx, lender, `${suffix}-overdue`, 'commercial');
    const withinDeadlineId = await approvedAccreditation(broker.ctx, lender, `${suffix}-current`, 'equipment_finance');

    await withAuthorizationContext(systemCtx, (client) =>
      client.query(`UPDATE accreditations SET training_deadline_at = now() - INTERVAL '1 day' WHERE id = $1`, [overdueId]),
    );

    const lapsedIds = await checkTrainingDeadlines(lender.ctx, lender.org.id);
    expect(lapsedIds).toContain(overdueId);
    expect(lapsedIds).not.toContain(withinDeadlineId);

    const overdue = await withAuthorizationContext(systemCtx, (client) => client.query(`SELECT status FROM accreditations WHERE id = $1`, [overdueId]));
    const current = await withAuthorizationContext(systemCtx, (client) => client.query(`SELECT status FROM accreditations WHERE id = $1`, [withinDeadlineId]));
    expect(overdue.rows[0].status).toBe('lapsed');
    expect(current.rows[0].status).toBe('pending');
  });

  it('an already-active accreditation is untouched even with a past deadline', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const lender = await seedLender(suffix);
    const accreditationId = await approvedAccreditation(broker.ctx, lender, suffix);

    await activateAccreditation(lender.ctx, accreditationId);
    await withAuthorizationContext(systemCtx, (client) =>
      client.query(`UPDATE accreditations SET training_deadline_at = now() - INTERVAL '1 day' WHERE id = $1`, [accreditationId]),
    );

    const lapsedIds = await checkTrainingDeadlines(lender.ctx, lender.org.id);
    expect(lapsedIds).not.toContain(accreditationId);

    const { rows } = await withAuthorizationContext(systemCtx, (client) => client.query(`SELECT status FROM accreditations WHERE id = $1`, [accreditationId]));
    expect(rows[0].status).toBe('active');
  });
});
