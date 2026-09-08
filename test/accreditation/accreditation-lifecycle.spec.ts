/**
 * ACR-001/002 + REV-001/003/004/006: broker requests -> appears in the lender's queue
 * -> reviewer requests more information -> broker sees the updated status -> reviewer
 * escalates -> a non-senior_approver is rejected approving the escalated one -> the
 * actual senior_approver approves -> status is 'pending' (not 'active' — see the
 * Epic 10 plan's Scope decision). A separate case covers a straightforward decline.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { AccreditationModule } from '../../src/modules/accreditation/accreditation.module';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';

const systemCtx = { actorType: 'system' as const };

describe('accreditation lifecycle (ACR-001/002, REV-001/003/004/006)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AccreditationModule, IdentityModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function registerAndLoginBroker(suffix: string) {
    const email = `accr-lifecycle-broker-${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Accr', lastName: 'Broker' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    return { token: login.body.accessToken as string, email };
  }

  async function seedAndLoginClientUser(suffix: string, clientOrganisationId: string, role: string) {
    const email = `accr-lifecycle-client-${suffix}@example.com`;
    await createClientUser(systemCtx, { clientOrganisationId, email, password: 'dev-password-123456', role: role as never });

    const login = await request(app.getHttpServer())
      .post('/auth/client/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    const enroll = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll')
      .set('Authorization', `Bearer ${login.body.pendingToken}`)
      .expect(201);
    const code = authenticator.generate(enroll.body.secret);
    const confirmed = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll/confirm')
      .set('Authorization', `Bearer ${login.body.pendingToken}`)
      .send({ code })
      .expect(201);
    return { token: confirmed.body.accessToken as string };
  }

  async function setupScenario(suffix: string) {
    const broker = await registerAndLoginBroker(suffix);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Accr Lifecycle Lender ${suffix}` });
    const reviewer = await seedAndLoginClientUser(`${suffix}-reviewer`, org.id, 'reviewer');
    const seniorApprover = await seedAndLoginClientUser(`${suffix}-senior`, org.id, 'senior_approver');

    const brokerCtx = { actorType: 'broker' as const, actorId: await brokerIdFor(broker.email) };
    const business = await createBusiness(brokerCtx, brokerCtx.actorId, { entityType: 'company', legalName: `Accr Co ${suffix}` });
    await requestRelationship(brokerCtx, {
      brokerProfileId: brokerCtx.actorId,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    return { broker, org, reviewer, seniorApprover, business, brokerCtx };
  }

  async function brokerIdFor(email: string): Promise<string> {
    return withAuthorizationContext(systemCtx, async (client) => {
      const { rows } = await client.query(`SELECT id FROM broker_profiles WHERE email = $1`, [email.toLowerCase()]);
      return rows[0].id as string;
    });
  }

  it('request -> queue -> request-information -> escalate -> role-gated approve -> pending', async () => {
    const suffix = Date.now().toString();
    const { broker, org, reviewer, seniorApprover, business } = await setupScenario(suffix);

    const created = await request(app.getHttpServer())
      .post('/accreditations')
      .set('Authorization', `Bearer ${broker.token}`)
      .send({
        lenderClientOrganisationId: org.id,
        brokerBusinessId: business.id,
        classification: 'new_broker_introducer',
        brand: 'default',
        role: 'broker',
        productScope: 'commercial',
        licenceHolderType: 'aggregator_organisation',
        licenceHolderClientOrganisationId: org.id,
      })
      .expect(201);
    const accreditationId = created.body.id as string;

    const queue = await request(app.getHttpServer())
      .get(`/accreditations/queue?lenderClientOrganisationId=${org.id}`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .expect(200);
    expect(queue.body.map((a: { id: string }) => a.id)).toContain(accreditationId);
    expect(queue.body[0].status).toBe('requested');

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/request-information`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ itemisedReasons: ['Missing certificate IV'] })
      .expect(201);

    const mineAfterInfo = await request(app.getHttpServer())
      .get('/accreditations/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(200);
    expect(mineAfterInfo.body[0].status).toBe('information_required');

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/escalate`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ rationale: 'needs senior review' })
      .expect(201);

    // reviewer (not senior_approver) cannot approve once escalated.
    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/approve`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/approve`)
      .set('Authorization', `Bearer ${seniorApprover.token}`)
      .send({ rationale: 'looks good' })
      .expect(201);

    const mineAfterApproval = await request(app.getHttpServer())
      .get('/accreditations/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(200);
    expect(mineAfterApproval.body[0].status).toBe('pending');
  });

  it('decline with rationale', async () => {
    const suffix = Date.now().toString();
    const { broker, org, reviewer, business } = await setupScenario(suffix);

    const created = await request(app.getHttpServer())
      .post('/accreditations')
      .set('Authorization', `Bearer ${broker.token}`)
      .send({
        lenderClientOrganisationId: org.id,
        brokerBusinessId: business.id,
        classification: 'new_broker_introducer',
        brand: 'default',
        role: 'broker',
        productScope: 'commercial',
        licenceHolderType: 'broking_business',
        licenceHolderBrokerBusinessId: business.id,
      })
      .expect(201);
    const accreditationId = created.body.id as string;

    // decline requires a rationale.
    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/decline`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/decline`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ rationale: 'incomplete profile' })
      .expect(201);

    const mine = await request(app.getHttpServer())
      .get('/accreditations/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(200);
    expect(mine.body[0].status).toBe('declined');
  });
});
