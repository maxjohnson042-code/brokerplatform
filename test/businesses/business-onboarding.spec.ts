/**
 * BUS-001/003-008/013-015 end to end over HTTP: sole-trader auto-derivation, the
 * draft -> outstanding-items -> submit lifecycle (mirrors
 * test/brokers/broker-profile.spec.ts's pattern for broker profiles), and the
 * search -> request -> confirm -> end affiliation flow between two brokers.
 *
 * Nothing in Epic 4 can move a business to 'verified' (that's Epic 6/7's job) — the
 * search+affiliate flow needs one, so this test seeds it directly via a system-actor
 * query, the same test-only workaround scripts/demo-tenancy.ts already uses for
 * check results.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BusinessesModule } from '../../src/modules/businesses/businesses.module';
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';

describe('broker business onboarding (BUS-001/003-008/013-015)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BusinessesModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function registerAndLogin(suffix: string) {
    const email = `biz-onboarding-${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Jamie', lastName: 'Nguyen' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    return login.body.accessToken as string;
  }

  async function markVerified(businessId: string) {
    await withAuthorizationContext({ actorType: 'system' }, (client) =>
      client.query(`UPDATE broker_businesses SET status = 'verified' WHERE id = $1`, [businessId]),
    );
  }

  it('derives the sole trader business record from the broker\'s own details without asking twice', async () => {
    const token = await registerAndLogin(`sole-${Date.now()}`);

    const created = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${token}`)
      .send({ entityType: 'sole_trader' })
      .expect(201);

    const business = await request(app.getHttpServer())
      .get(`/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(business.body.legal_name).toBe('Jamie Nguyen');

    const principals = await request(app.getHttpServer())
      .get(`/businesses/${created.body.id}/principals`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(principals.body).toHaveLength(1);
    expect(principals.body[0].first_name).toBe('Jamie');
  });

  it('walks the full draft -> complete -> submit lifecycle for a company', async () => {
    const token = await registerAndLogin(`company-${Date.now()}`);
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const created = await auth(request(app.getHttpServer()).post('/businesses'))
      .send({ entityType: 'company', legalName: 'Test Broking Pty Ltd' })
      .expect(201);
    const businessId = created.body.id;

    const initial = await auth(request(app.getHttpServer()).get(`/businesses/${businessId}/outstanding-items`)).expect(
      200,
    );
    const initialFields = initial.body.map((i: { field: string }) => i.field);
    expect(initialFields).toEqual(
      expect.arrayContaining(['registrationNumber', 'gstRegistered', 'businessEmail', 'address', 'principals']),
    );

    await auth(request(app.getHttpServer()).patch(`/businesses/${businessId}`))
      .send({
        abn: '51824753556',
        gstRegistered: true,
        businessEmail: 'ops@testbroking.example.com',
        address: { line1: '1 Test St', city: 'Sydney', postcode: '2000', state: 'NSW' },
      })
      .expect(200);

    await auth(request(app.getHttpServer()).post(`/businesses/${businessId}/submit`)).expect(400);

    await auth(request(app.getHttpServer()).post(`/businesses/${businessId}/principals`))
      .send({ role: 'director', firstName: 'Jamie', lastName: 'Nguyen', email: 'jamie@testbroking.example.com' })
      .expect(201);

    const afterAll = await auth(request(app.getHttpServer()).get(`/businesses/${businessId}/outstanding-items`)).expect(
      200,
    );
    expect(afterAll.body).toEqual([]);

    await auth(request(app.getHttpServer()).post(`/businesses/${businessId}/submit`)).expect(201);

    const business = await auth(request(app.getHttpServer()).get(`/businesses/${businessId}`)).expect(200);
    expect(business.body.status).toBe('submitted');

    await auth(request(app.getHttpServer()).patch(`/businesses/${businessId}`))
      .send({ legalName: 'Changed' })
      .expect(409);
  });

  it('requires a trustee name for a trust before submit', async () => {
    const token = await registerAndLogin(`trust-${Date.now()}`);
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const created = await auth(request(app.getHttpServer()).post('/businesses'))
      .send({
        entityType: 'trust',
        legalName: 'Example Pty Ltd as trustee for Example Trust',
        acn: '123456789',
        gstRegistered: true,
        businessEmail: 'trust@example.com',
        address: { line1: '1 Trust Way', city: 'Perth', postcode: '6000', state: 'WA' },
      })
      .expect(201);
    await auth(request(app.getHttpServer()).post(`/businesses/${created.body.id}/principals`)).send({
      role: 'trustee',
      firstName: 'Trust',
      lastName: 'Ee',
    });

    const outstanding = await auth(
      request(app.getHttpServer()).get(`/businesses/${created.body.id}/outstanding-items`),
    ).expect(200);
    expect(outstanding.body.map((i: { field: string }) => i.field)).toContain('trusteeName');
  });

  it('search -> request -> confirm -> end affiliation, between two brokers', async () => {
    const suffix = Date.now();
    const founderToken = await registerAndLogin(`founder-${suffix}`);
    const joinerToken = await registerAndLogin(`joiner-${suffix}`);
    const abn = `9${suffix}`.slice(0, 11);

    const created = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${founderToken}`)
      .send({ entityType: 'company', legalName: 'Searchable Co', abn })
      .expect(201);
    await markVerified(created.body.id);

    const found = await request(app.getHttpServer())
      .get(`/businesses/search?abn=${abn}`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(200);
    expect(found.body.map((b: { id: string }) => b.id)).toContain(created.body.id);

    // Cannot yet read the full business — no affiliation, pending or otherwise.
    await request(app.getHttpServer())
      .get(`/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(404);

    const affiliation = await request(app.getHttpServer())
      .post(`/businesses/${created.body.id}/affiliate`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(201);

    // Still not visible while pending — the specific gap this epic closed.
    await request(app.getHttpServer())
      .get(`/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(404);

    // The joiner cannot confirm their own request.
    await request(app.getHttpServer())
      .post(`/businesses/${created.body.id}/affiliations/${affiliation.body.id}/confirm`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/businesses/${created.body.id}/affiliations/${affiliation.body.id}/confirm`)
      .set('Authorization', `Bearer ${founderToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/businesses/me/affiliations/${affiliation.body.id}/end`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ reason: 'left the panel' })
      .expect(201);

    // Ended, and not the founder's to end again either.
    await request(app.getHttpServer())
      .post(`/businesses/me/affiliations/${affiliation.body.id}/end`)
      .set('Authorization', `Bearer ${joinerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/businesses/me/affiliations/${affiliation.body.id}/end`)
      .set('Authorization', `Bearer ${founderToken}`)
      .expect(404);
  });
});
