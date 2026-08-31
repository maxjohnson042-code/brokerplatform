/**
 * First HTTP-level tests in the repo — @nestjs/testing boots just IdentityModule (not
 * the whole AppModule) and drives it with supertest, proving the controller/guard/DTO
 * wiring end to end against the real dev database (same DB the demo scripts use, with
 * unique-suffixed emails per run — see demo-tenancy.ts's precedent, reused here rather
 * than standing up a separate test database for this pass).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { pool } from '../../src/db/pool';

describe('broker auth (AUTH-001–005)', () => {
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

  function uniqueEmail(): string {
    return `broker-spec-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  }

  it('registers, logs in, and reaches an authenticated endpoint with the resulting access token', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Test', lastName: 'Broker' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    expect(login.body.accessToken).toEqual(expect.any(String));
    expect(login.body.refreshToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/auth/broker/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ refreshToken: login.body.refreshToken })
      .expect(201);
  });

  it('rejects login with the wrong password', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Test', lastName: 'Broker' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'wrong-password-entirely' })
      .expect(401);
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Test', lastName: 'Broker' });
    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' });

    const rotated = await request(app.getHttpServer())
      .post('/auth/broker/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(201);
    expect(rotated.body.refreshToken).not.toEqual(login.body.refreshToken);

    // Reuse of the now-revoked original token is treated as theft: rejected, AND it
    // kills the token /refresh just issued too (identity.repository.ts's
    // rotateRefreshToken reuse-detection design).
    await request(app.getHttpServer())
      .post('/auth/broker/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/broker/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('changes password and revokes outstanding sessions', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Test', lastName: 'Broker' });
    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' });

    await request(app.getHttpServer())
      .post('/auth/broker/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: 'dev-password-123456', newPassword: 'brand-new-password-1' })
      .expect(201);

    // The refresh token issued before the password change is revoked as part of it.
    await request(app.getHttpServer())
      .post('/auth/broker/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'brand-new-password-1' })
      .expect(201);
  });

  it('completes a full password-reset round trip via the console email fallback', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Test', lastName: 'Broker' });

    // ConsoleEmailSender logs the token instead of sending it (see
    // src/modules/notifications/email-sender.ts) — intercept console.log to recover it
    // rather than adding a test-only seam to the production email port.
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await request(app.getHttpServer())
      .post('/auth/broker/request-password-reset')
      .send({ email })
      .expect(201);
    const logged = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    logSpy.mockRestore();
    const token = /\(valid for 1 hour\): (\S+)/.exec(logged)?.[1];
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .post('/auth/broker/reset-password')
      .send({ token, newPassword: 'reset-password-99' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'reset-password-99' })
      .expect(201);

    // Single-use: the same token cannot be redeemed twice.
    await request(app.getHttpServer())
      .post('/auth/broker/reset-password')
      .send({ token, newPassword: 'another-password-2' })
      .expect(409);
  });

  it('returns 200-shaped ok even when the email does not match an account (no user enumeration)', async () => {
    await request(app.getHttpServer())
      .post('/auth/broker/request-password-reset')
      .send({ email: `nobody-${Date.now()}@example.com` })
      .expect(201)
      .expect({ ok: true });
  });
});
