/**
 * ONB-002/003/005/006/008/009/012 end to end over HTTP: register -> login -> partial
 * saves shrink the outstanding-items list -> attest -> add an association membership
 * -> outstanding-items empty -> submit succeeds -> further edits are rejected.
 *
 * Imports just BrokersModule (which imports IdentityModule itself, per
 * brokers.module.ts) — Nest mounts every controller in the whole compiled module
 * graph regardless of which module declares it, so /auth/broker/* and /brokers/me/*
 * are both live here, same as they would be under the real AppModule.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BrokersModule } from '../../src/modules/brokers/brokers.module';
import { pool } from '../../src/db/pool';

describe('broker profile build (ONB-002/003/005/006/008/009/012)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BrokersModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function registerAndLogin() {
    const email = `broker-profile-spec-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Test', lastName: 'Broker' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    return login.body.accessToken as string;
  }

  it('walks the full draft -> complete -> submit lifecycle', async () => {
    const token = await registerAndLogin();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    // Freshly registered: first/last name are set (from register), everything else
    // required is outstanding.
    const initial = await auth(request(app.getHttpServer()).get('/brokers/me/outstanding-items')).expect(200);
    const initialFields = initial.body.map((i: { field: string }) => i.field);
    expect(initialFields).toEqual(
      expect.arrayContaining([
        'dateOfBirth',
        'phoneNumber',
        'mobileNumber',
        'address',
        'experienceYears',
        'licenceTypeHeld',
        'associationMemberships',
        'attestedTermsAt',
      ]),
    );
    expect(initialFields).not.toContain('firstName');
    expect(initialFields).not.toContain('lastName');

    await auth(request(app.getHttpServer()).patch('/brokers/me'))
      .send({
        dateOfBirth: '1990-01-01',
        phoneNumber: '+61 2 5555 0000',
        mobileNumber: '+61 4 5555 0000',
        experienceYears: 5,
        address: { line1: '1 Test St', city: 'Sydney', postcode: '2000', state: 'NSW' },
        licenceTypeHeld: 'credit_representative',
        creditRepresentativeNumber: 'CR123456',
        licensingEntityName: 'Example Aggregator Pty Ltd',
        licensingEntityNumber: 'ACL999999',
      })
      .expect(200);

    const afterPatch = await auth(request(app.getHttpServer()).get('/brokers/me/outstanding-items')).expect(200);
    const afterPatchFields = afterPatch.body.map((i: { field: string }) => i.field);
    expect(afterPatchFields).toEqual(['associationMemberships', 'attestedTermsAt']);

    await auth(request(app.getHttpServer()).post('/brokers/me/associations'))
      .send({ associationName: 'MFAA', membershipNumber: 'MFAA-000123' })
      .expect(201);

    await auth(request(app.getHttpServer()).post('/brokers/me/attest-terms')).expect(201);

    const afterAll = await auth(request(app.getHttpServer()).get('/brokers/me/outstanding-items')).expect(200);
    expect(afterAll.body).toEqual([]);

    await auth(request(app.getHttpServer()).post('/brokers/me/submit')).expect(201);

    const profile = await auth(request(app.getHttpServer()).get('/brokers/me')).expect(200);
    expect(profile.body.status).toBe('submitted');

    // Post-submission, edits are rejected (409) — the record may already be in review.
    await auth(request(app.getHttpServer()).patch('/brokers/me')).send({ firstName: 'Changed' }).expect(409);
    await auth(request(app.getHttpServer()).post('/brokers/me/associations'))
      .send({ associationName: 'FBAA', membershipNumber: 'FBAA-1' })
      .expect(409);
  });

  it('rejects submit while items are outstanding, listing exactly what is missing', async () => {
    const token = await registerAndLogin();
    const res = await request(app.getHttpServer())
      .post('/brokers/me/submit')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.map((i: { field: string }) => i.field)).toContain('licenceTypeHeld');
  });

  it('lets a broker edit and remove an association membership while still draft', async () => {
    const token = await registerAndLogin();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const created = await auth(request(app.getHttpServer()).post('/brokers/me/associations'))
      .send({ associationName: 'MFAA', membershipNumber: 'MFAA-typo' })
      .expect(201);

    await auth(request(app.getHttpServer()).patch(`/brokers/me/associations/${created.body.id}`))
      .send({ membershipNumber: 'MFAA-corrected' })
      .expect(200);

    const list = await auth(request(app.getHttpServer()).get('/brokers/me/associations')).expect(200);
    expect(list.body[0].membership_number).toBe('MFAA-corrected');

    await auth(request(app.getHttpServer()).delete(`/brokers/me/associations/${created.body.id}`)).expect(200);
    const afterDelete = await auth(request(app.getHttpServer()).get('/brokers/me/associations')).expect(200);
    expect(afterDelete.body).toHaveLength(0);
  });

  it('a broker cannot read or act on another broker\'s profile via /brokers/me (each token is scoped to its own actor)', async () => {
    const tokenA = await registerAndLogin();
    const tokenB = await registerAndLogin();

    const profileA = await request(app.getHttpServer())
      .get('/brokers/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const profileB = await request(app.getHttpServer())
      .get('/brokers/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(profileA.body.id).not.toBe(profileB.body.id);
  });
});
