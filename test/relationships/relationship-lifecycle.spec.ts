/**
 * REL-001-007/010 end to end over HTTP: both relationship directions
 * (broker-initiated, immediately active; client-initiated invitation, broker
 * accepts/declines), revoke (broker) and end (client, reason required), and both
 * list views correctly scoped to their own actor.
 *
 * Client-user actors need to clear mandatory MFA first (Epic 2) — the same
 * login -> enroll -> confirm flow test/identity/client-mfa.spec.ts already
 * established, reused here rather than inventing a second pattern.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authenticator } from 'otplib';
import { RelationshipsModule } from '../../src/modules/relationships/relationships.module';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { pool } from '../../src/db/pool';
import { createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';

const systemCtx = { actorType: 'system' as const };

describe('relationship lifecycle (REL-001-007/010)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [RelationshipsModule, IdentityModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function registerAndLoginBroker(suffix: string) {
    const email = `rel-lifecycle-${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/broker/register')
      .send({ email, password: 'dev-password-123456', firstName: 'Jamie', lastName: 'Nguyen' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/broker/login')
      .send({ email, password: 'dev-password-123456' })
      .expect(201);
    return { token: login.body.accessToken as string, email };
  }

  async function seedAndLoginClientUser(suffix: string) {
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Lifecycle Lender ${suffix}` });
    const email = `rel-lifecycle-client-${suffix}@example.com`;
    await createClientUser(systemCtx, {
      clientOrganisationId: org.id,
      email,
      password: 'dev-password-123456',
      role: 'relationship_manager',
    });

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

    return { token: confirmed.body.accessToken as string, org };
  }

  it('broker-initiated: active immediately, visible in the broker\'s own list', async () => {
    const suffix = Date.now().toString();
    const broker = await registerAndLoginBroker(`broker-${suffix}`);
    const client = await seedAndLoginClientUser(`client-${suffix}`);

    const created = await request(app.getHttpServer())
      .post('/relationships')
      .set('Authorization', `Bearer ${broker.token}`)
      .send({ clientOrganisationId: client.org.id, type: 'lender_panel', consentVersion: 'v1' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/relationships/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].status).toBe('active');
    expect(list.body[0].id).toBe(created.body.id);
  });

  it('client-initiated: invite -> accept -> active, and both list views agree', async () => {
    const suffix = Date.now().toString();
    const broker = await registerAndLoginBroker(`invitee-${suffix}`);
    const client = await seedAndLoginClientUser(`inviter-${suffix}`);

    const invitation = await request(app.getHttpServer())
      .post('/relationships/invitations')
      .set('Authorization', `Bearer ${client.token}`)
      .send({ brokerEmail: broker.email, type: 'lender_panel' })
      .expect(201);

    const beforeAccept = await request(app.getHttpServer())
      .get('/relationships/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(200);
    expect(beforeAccept.body[0].status).toBe('pending_acceptance');

    await request(app.getHttpServer())
      .post(`/relationships/${invitation.body.id}/accept`)
      .set('Authorization', `Bearer ${broker.token}`)
      .send({ consentVersion: 'v1' })
      .expect(201);

    const afterAccept = await request(app.getHttpServer())
      .get('/relationships/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(200);
    expect(afterAccept.body[0].status).toBe('active');

    const orgList = await request(app.getHttpServer())
      .get('/relationships/organisation')
      .set('Authorization', `Bearer ${client.token}`)
      .expect(200);
    expect(orgList.body[0].status).toBe('active');
  });

  it('client-initiated: broker can decline instead', async () => {
    const suffix = Date.now().toString();
    const broker = await registerAndLoginBroker(`decliner-${suffix}`);
    const client = await seedAndLoginClientUser(`decline-inviter-${suffix}`);

    const invitation = await request(app.getHttpServer())
      .post('/relationships/invitations')
      .set('Authorization', `Bearer ${client.token}`)
      .send({ brokerEmail: broker.email, type: 'lender_panel' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/relationships/${invitation.body.id}/decline`)
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/relationships/me')
      .set('Authorization', `Bearer ${broker.token}`)
      .expect(200);
    expect(list.body[0].status).toBe('declined');

    // Can't accept a declined invitation.
    await request(app.getHttpServer())
      .post(`/relationships/${invitation.body.id}/accept`)
      .set('Authorization', `Bearer ${broker.token}`)
      .send({ consentVersion: 'v1' })
      .expect(409);
  });

  it('inviting an email with no registered broker account fails clearly', async () => {
    const suffix = Date.now().toString();
    const client = await seedAndLoginClientUser(`no-such-broker-${suffix}`);

    await request(app.getHttpServer())
      .post('/relationships/invitations')
      .set('Authorization', `Bearer ${client.token}`)
      .send({ brokerEmail: `nobody-${suffix}@example.com`, type: 'lender_panel' })
      .expect(404);
  });

  it('broker revokes their own active relationship; client ends another with a required reason', async () => {
    const suffix = Date.now().toString();
    const brokerA = await registerAndLoginBroker(`revoker-${suffix}`);
    const brokerB = await registerAndLoginBroker(`ended-${suffix}`);
    const client = await seedAndLoginClientUser(`revoke-end-${suffix}`);

    const relA = await request(app.getHttpServer())
      .post('/relationships')
      .set('Authorization', `Bearer ${brokerA.token}`)
      .send({ clientOrganisationId: client.org.id, type: 'lender_panel', consentVersion: 'v1' })
      .expect(201);
    const relB = await request(app.getHttpServer())
      .post('/relationships')
      .set('Authorization', `Bearer ${brokerB.token}`)
      .send({ clientOrganisationId: client.org.id, type: 'lender_panel', consentVersion: 'v1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/relationships/${relA.body.id}/revoke`)
      .set('Authorization', `Bearer ${brokerA.token}`)
      .send({ reason: 'moving on' })
      .expect(201);

    // Reason is required for a client ending a relationship.
    await request(app.getHttpServer())
      .post(`/relationships/${relB.body.id}/end`)
      .set('Authorization', `Bearer ${client.token}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post(`/relationships/${relB.body.id}/end`)
      .set('Authorization', `Bearer ${client.token}`)
      .send({ reason: 'panel restructure' })
      .expect(201);

    const orgList = await request(app.getHttpServer())
      .get('/relationships/organisation')
      .set('Authorization', `Bearer ${client.token}`)
      .expect(200);
    const revoked = orgList.body.find((r: { id: string }) => r.id === relA.body.id);
    const ended = orgList.body.find((r: { id: string }) => r.id === relB.body.id);
    expect(revoked.status).toBe('revoked');
    expect(revoked.effective_to).not.toBeNull();
    expect(ended.status).toBe('ended');
    expect(ended.end_reason).toBe('panel restructure');

    // A broker cannot end (client-only) or revoke someone else's relationship.
    await request(app.getHttpServer())
      .post(`/relationships/${relB.body.id}/revoke`)
      .set('Authorization', `Bearer ${brokerA.token}`)
      .send({})
      .expect(404);
  });
});
