/**
 * Epic 11: no in-platform training delivery — approval sets a real deadline, the
 * lender confirms platform/product training happened off-platform, and activation is
 * an independent, explicit lender action (confirmations never auto-activate).
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

describe('training confirmation and activation (TRN-006/007/008 subset)', () => {
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
    const email = `training-lifecycle-broker-${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Training', lastName: 'Broker' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    return { token: login.body.accessToken as string, email };
  }

  async function seedAndLoginClientUser(suffix: string, clientOrganisationId: string) {
    const email = `training-lifecycle-client-${suffix}@example.com`;
    await createClientUser(systemCtx, { clientOrganisationId, email, password: 'dev-password-123456', role: 'reviewer' });

    const login = await request(app.getHttpServer()).post('/auth/client/login').send({ email, password: 'dev-password-123456' }).expect(201);
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

  async function brokerIdFor(email: string): Promise<string> {
    return withAuthorizationContext(systemCtx, async (client) => {
      const { rows } = await client.query(`SELECT id FROM broker_profiles WHERE email = $1`, [email.toLowerCase()]);
      return rows[0].id as string;
    });
  }

  async function approvedAccreditation(suffix: string) {
    const broker = await registerAndLoginBroker(suffix);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Training Lifecycle Lender ${suffix}` });
    const reviewer = await seedAndLoginClientUser(suffix, org.id);
    const brokerCtx = { actorType: 'broker' as const, actorId: await brokerIdFor(broker.email) };
    const business = await createBusiness(brokerCtx, brokerCtx.actorId, { entityType: 'company', legalName: `Training Co ${suffix}` });
    await requestRelationship(brokerCtx, { brokerProfileId: brokerCtx.actorId, clientOrganisationId: org.id, type: 'lender_panel', consentVersion: 'v1' });

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

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/approve`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({})
      .expect(201);

    return { accreditationId, broker, reviewer };
  }

  it('approval sets a real training deadline', async () => {
    const suffix = Date.now().toString();
    const { accreditationId, reviewer } = await approvedAccreditation(suffix);

    const full = await request(app.getHttpServer()).get(`/accreditations/${accreditationId}`).set('Authorization', `Bearer ${reviewer.token}`).expect(200);
    expect(full.body.accreditation.status).toBe('pending');
    expect(full.body.accreditation.training_deadline_at).not.toBeNull();
    const deadline = new Date(full.body.accreditation.training_deadline_at);
    expect(deadline.getTime()).toBeGreaterThan(Date.now());
  });

  it('confirmations never auto-activate; activation is a separate, explicit lender action', async () => {
    const suffix = Date.now().toString();
    const { accreditationId, reviewer } = await approvedAccreditation(suffix);

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/confirm-training`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ kind: 'platform' })
      .expect(201);

    let current = await request(app.getHttpServer()).get(`/accreditations/${accreditationId}`).set('Authorization', `Bearer ${reviewer.token}`).expect(200);
    expect(current.body.accreditation.status).toBe('pending');

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/confirm-training`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .send({ kind: 'product', notes: 'completed the equipment finance module' })
      .expect(201);

    // Still pending — both kinds confirmed does not auto-activate.
    current = await request(app.getHttpServer()).get(`/accreditations/${accreditationId}`).set('Authorization', `Bearer ${reviewer.token}`).expect(200);
    expect(current.body.accreditation.status).toBe('pending');

    const confirmations = await request(app.getHttpServer())
      .get(`/accreditations/${accreditationId}/training-confirmations`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .expect(200);
    expect(confirmations.body.map((c: { kind: string }) => c.kind).sort()).toEqual(['platform', 'product']);

    await request(app.getHttpServer())
      .post(`/accreditations/${accreditationId}/activate`)
      .set('Authorization', `Bearer ${reviewer.token}`)
      .expect(201);

    current = await request(app.getHttpServer()).get(`/accreditations/${accreditationId}`).set('Authorization', `Bearer ${reviewer.token}`).expect(200);
    expect(current.body.accreditation.status).toBe('active');
    expect(current.body.accreditation.activated_at).not.toBeNull();
  });

  it('activation is rejected on a non-pending accreditation', async () => {
    const suffix = Date.now().toString();
    const { accreditationId, reviewer } = await approvedAccreditation(suffix);

    await request(app.getHttpServer()).post(`/accreditations/${accreditationId}/activate`).set('Authorization', `Bearer ${reviewer.token}`).expect(201);

    // Already active — a second activate is rejected.
    await request(app.getHttpServer()).post(`/accreditations/${accreditationId}/activate`).set('Authorization', `Bearer ${reviewer.token}`).expect(409);
  });
});
