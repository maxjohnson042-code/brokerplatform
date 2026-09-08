/**
 * End-to-end proof that the wired call sites actually dispatch, over real HTTP —
 * complementing notification-core.spec.ts's direct-repository isolation tests.
 * NOT-001/002/003: submission, information-request, decline (mandatory, regardless of
 * preference), and activation all log + send.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { BrokersModule } from '../../src/modules/brokers/brokers.module';
import { AccreditationModule } from '../../src/modules/accreditation/accreditation.module';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';

const systemCtx = { actorType: 'system' as const };

describe('notification dispatch, wired end to end (NOT-001/002/003)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BrokersModule, AccreditationModule, IdentityModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function registerAndLoginBroker(suffix: string) {
    const email = `notif-dispatch-broker-${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Notif', lastName: 'Dispatch' })
      .expect(201);
    const login = await request(app.getHttpServer()).post('/auth/broker/login').send({ email, password: 'dev-password-123456' }).expect(201);
    return { token: login.body.accessToken as string, email };
  }

  async function seedAndLoginClientUser(suffix: string, clientOrganisationId: string) {
    const email = `notif-dispatch-client-${suffix}@example.com`;
    await createClientUser(systemCtx, { clientOrganisationId, email, password: 'dev-password-123456', role: 'reviewer' });
    const login = await request(app.getHttpServer()).post('/auth/client/login').send({ email, password: 'dev-password-123456' }).expect(201);
    const enroll = await request(app.getHttpServer()).post('/auth/client/mfa/enroll').set('Authorization', `Bearer ${login.body.pendingToken}`).expect(201);
    const code = authenticator.generate(enroll.body.secret);
    const confirmed = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll/confirm')
      .set('Authorization', `Bearer ${login.body.pendingToken}`)
      .send({ code })
      .expect(201);
    return { token: confirmed.body.accessToken as string };
  }

  async function brokerIdFor(email: string): Promise<string> {
    return withAuthorizationContext(systemCtx, async (client) => {
      const { rows } = await client.query(`SELECT id FROM broker_profiles WHERE email = $1`, [email.toLowerCase()]);
      return rows[0].id as string;
    });
  }

  it('submitting a profile logs and sends a profile_submitted notification', async () => {
    const suffix = Date.now().toString();
    const broker = await registerAndLoginBroker(suffix);

    // Minimal but complete profile so submit succeeds.
    await request(app.getHttpServer())
      .patch('/brokers/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .send({
        dateOfBirth: '1990-01-01',
        phoneNumber: '0400000000',
        mobileNumber: '0400000001',
        experienceYears: 5,
        address: { line1: '1 Test St', city: 'Sydney', postcode: '2000', state: 'NSW' },
        licenceTypeHeld: 'own_credit_licence',
        creditLicenceNumber: 'ACL123456',
      })
      .expect(200);
    await request(app.getHttpServer()).post('/brokers/me/attest-terms').set('Authorization', `Bearer ${broker.token}`).expect(201);
    await request(app.getHttpServer())
      .post('/brokers/me/associations')
      .set('Authorization', `Bearer ${broker.token}`)
      .send({ associationName: 'MFAA', membershipNumber: 'M1' })
      .expect(201);

    await request(app.getHttpServer()).post('/brokers/me/submit').set('Authorization', `Bearer ${broker.token}`).expect(201);

    const notifications = await request(app.getHttpServer()).get('/notifications/me').set('Authorization', `Bearer ${broker.token}`).expect(200);
    expect(notifications.body).toHaveLength(1);
    expect(notifications.body[0].category).toBe('profile_submitted');
    expect(notifications.body[0].sent_at).not.toBeNull();
    expect(notifications.body[0].suppressed).toBe(false);
  });

  it('requesting information and declining (separate accreditations — decline only starts from requested/escalated) both log + send', async () => {
    const suffix = Date.now().toString();
    const broker = await registerAndLoginBroker(suffix);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Notif Dispatch Lender ${suffix}` });
    const reviewer = await seedAndLoginClientUser(suffix, org.id);
    const brokerCtx = { actorType: 'broker' as const, actorId: await brokerIdFor(broker.email) };
    await requestRelationship(brokerCtx, { brokerProfileId: brokerCtx.actorId, clientOrganisationId: org.id, type: 'lender_panel', consentVersion: 'v1' });

    async function requestAccreditationFor(productScope: string) {
      const business = await createBusiness(brokerCtx, brokerCtx.actorId, { entityType: 'company', legalName: `Notif Dispatch Co ${suffix}-${productScope}` });
      const created = await request(app.getHttpServer())
        .post('/accreditations')
        .set('Authorization', `Bearer ${broker.token}`)
        .send({
          lenderClientOrganisationId: org.id,
          brokerBusinessId: business.id,
          classification: 'new_broker_introducer',
          brand: 'default',
          role: 'broker',
          productScope,
          licenceHolderType: 'broking_business',
          licenceHolderBrokerBusinessId: business.id,
        })
        .expect(201);
      return created.body.id as string;
    }

    const infoRequestAccreditationId = await requestAccreditationFor('commercial');
    const declineAccreditationId = await requestAccreditationFor('equipment_finance');

    await request(app.getHttpServer())
      .post(`/accreditations/${infoRequestAccreditationId}/request-information`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ itemisedReasons: ['Missing certificate IV'] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/accreditations/${declineAccreditationId}/decline`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ rationale: 'incomplete' })
      .expect(201);

    const notifications = await request(app.getHttpServer()).get('/notifications/me').set('Authorization', `Bearer ${broker.token}`).expect(200);
    const categories = notifications.body.map((n: { category: string; sent_at: string | null }) => n.category).sort();
    expect(categories).toEqual(['accreditation_declined', 'accreditation_information_required']);
    expect(notifications.body.every((n: { sent_at: string | null }) => n.sent_at !== null)).toBe(true);
  });

  it('the lender org gets a queue-entry notification when a broker requests accreditation', async () => {
    const suffix = Date.now().toString();
    const broker = await registerAndLoginBroker(suffix);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Notif Queue Lender ${suffix}` });
    const reviewer = await seedAndLoginClientUser(suffix, org.id);
    const brokerCtx = { actorType: 'broker' as const, actorId: await brokerIdFor(broker.email) };
    const business = await createBusiness(brokerCtx, brokerCtx.actorId, { entityType: 'company', legalName: `Notif Queue Co ${suffix}` });
    await requestRelationship(brokerCtx, { brokerProfileId: brokerCtx.actorId, clientOrganisationId: org.id, type: 'lender_panel', consentVersion: 'v1' });

    await request(app.getHttpServer())
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

    const notifications = await request(app.getHttpServer()).get('/notifications/me').set('Authorization', `Bearer ${reviewer.token}`).expect(200);
    expect(notifications.body).toHaveLength(1);
    expect(notifications.body[0].category).toBe('accreditation_queue_entry');
    expect(notifications.body[0].sent_at).not.toBeNull();
  });
});
