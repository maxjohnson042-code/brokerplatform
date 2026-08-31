/**
 * AUTH-002/006/008 for client_users: login never yields a full access token until MFA
 * enrolment (first login) or verification (subsequent logins) completes — proves the
 * two-stage pending-token design in identity.service.ts holds over real HTTP, then
 * exercises AUTH-008 provisioning/deactivation as the resulting client_admin.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { pool } from '../../src/db/pool';
import { createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';

const systemCtx = { actorType: 'system' as const };

describe('client MFA login (AUTH-002/006) and client-admin provisioning (AUTH-008)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [IdentityModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function seedClientAdmin() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `MFA Spec Org ${suffix}` });
    const email = `mfa-admin-${suffix}@example.com`;
    await createClientUser(systemCtx, {
      clientOrganisationId: org.id,
      email,
      password: 'dev-password-123456',
      role: 'client_admin',
    });
    return { org, email };
  }

  it('never returns a full access token before MFA is enrolled and confirmed', async () => {
    const { email } = await seedClientAdmin();

    const login = await request(app.getHttpServer())
      .post('/auth/client/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    expect(login.body.tokenType).toBe('mfa_enrolment_pending');
    expect(login.body).not.toHaveProperty('accessToken');

    const enroll = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll')
      .set('Authorization', `Bearer ${login.body.pendingToken}`)
      .expect(201);
    expect(enroll.body.secret).toEqual(expect.any(String));
    expect(enroll.body.backupCodes).toHaveLength(10);

    const code = authenticator.generate(enroll.body.secret);
    const confirmed = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll/confirm')
      .set('Authorization', `Bearer ${login.body.pendingToken}`)
      .send({ code })
      .expect(201);
    expect(confirmed.body.accessToken).toEqual(expect.any(String));

    // Second login now requires mfa_pending (verify), not mfa_enrolment_pending again.
    const secondLogin = await request(app.getHttpServer())
      .post('/auth/client/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    expect(secondLogin.body.tokenType).toBe('mfa_pending');

    // /mfa/enroll rejects the wrong pending-token type — it is not a re-enrolment path.
    await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll')
      .set('Authorization', `Bearer ${secondLogin.body.pendingToken}`)
      .expect(401);

    const secondCode = authenticator.generate(enroll.body.secret);
    const verified = await request(app.getHttpServer())
      .post('/auth/client/mfa/verify')
      .set('Authorization', `Bearer ${secondLogin.body.pendingToken}`)
      .send({ code: secondCode })
      .expect(201);
    expect(verified.body.accessToken).toEqual(expect.any(String));
  });

  it('a client_admin can provision, list, and deactivate a client_user scoped to their own org', async () => {
    const { email } = await seedClientAdmin();
    const login = await request(app.getHttpServer()).post('/auth/client/login').send({ email, password: 'dev-password-123456' });
    const enroll = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll')
      .set('Authorization', `Bearer ${login.body.pendingToken}`);
    const code = authenticator.generate(enroll.body.secret);
    const confirmed = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll/confirm')
      .set('Authorization', `Bearer ${login.body.pendingToken}`)
      .send({ code });
    const accessToken = confirmed.body.accessToken;

    const reviewerEmail = `reviewer-spec-${Date.now()}@example.com`;
    const created = await request(app.getHttpServer())
      .post('/client-admin/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: reviewerEmail, password: 'dev-password-123456', role: 'reviewer' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/client-admin/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.map((u: { email: string }) => u.email)).toContain(reviewerEmail.toLowerCase());

    await request(app.getHttpServer())
      .post(`/client-admin/users/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/client/login')
      .send({ email: reviewerEmail, password: 'dev-password-123456' })
      .expect(401);
  });

  it('a non-client_admin role is forbidden from the client-admin user management endpoints', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `MFA Spec Reviewer Org ${suffix}` });
    const email = `plain-reviewer-${suffix}@example.com`;
    await createClientUser(systemCtx, {
      clientOrganisationId: org.id,
      email,
      password: 'dev-password-123456',
      role: 'reviewer',
    });

    const login = await request(app.getHttpServer()).post('/auth/client/login').send({ email, password: 'dev-password-123456' });
    const enroll = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll')
      .set('Authorization', `Bearer ${login.body.pendingToken}`);
    const code = authenticator.generate(enroll.body.secret);
    const confirmed = await request(app.getHttpServer())
      .post('/auth/client/mfa/enroll/confirm')
      .set('Authorization', `Bearer ${login.body.pendingToken}`)
      .send({ code });

    await request(app.getHttpServer())
      .get('/client-admin/users')
      .set('Authorization', `Bearer ${confirmed.body.accessToken}`)
      .expect(403);
  });
});
