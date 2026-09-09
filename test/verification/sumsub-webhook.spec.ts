/**
 * IDV-001/002/003/005/009: the full initiate -> webhook -> reviewerDecide lifecycle
 * for KYC (individual, mocked Sumsub HTTP layer only — not the DB, not any domain
 * logic) and the equivalent lifecycle for KYB (business, MockKybAdapter — no HTTP to
 * mock at all). Also covers webhook signature verification in isolation.
 */
import { createHmac } from 'crypto';
import { pool } from '../../src/db/pool';
import { withAuthorizationContext, AuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';
import { SumsubAdapter } from '../../src/modules/verification/providers/sumsub-adapter';
import { verifySumsubSignature } from '../../src/modules/verification/webhook-signature';
import {
  initiateVerification,
  recordWebhookResult,
  reviewerDecide,
} from '../../src/modules/verification/identity-verification.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `sumsub-webhook-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Verify',
    lastName: 'Broker',
  });
  return { id: broker.id, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function statusOf(table: 'broker_profiles' | 'broker_businesses', id: string): Promise<string> {
  return withAuthorizationContext(systemCtx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM ${table} WHERE id = $1`, [id]);
    return rows[0].status as string;
  });
}

describe('webhook signature verification', () => {
  const secret = 'test-webhook-secret';

  it('accepts a correctly signed payload', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifySumsubSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ hello: 'WORLD' }));
    expect(verifySumsubSignature(tampered, signature, secret)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    expect(verifySumsubSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifySumsubSignature(body, signature, '')).toBe(false);
  });
});

describe('KYC lifecycle (mocked Sumsub HTTP layer)', () => {
  it('moves broker_profiles.status through in_verification -> verified on approve', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-a`);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Verify Lender ${suffix}` });
    const reviewer = await createClientUser(systemCtx, {
      clientOrganisationId: org.id,
      email: `verify-reviewer-${suffix}@example.com`,
      password: 'dev-password-123456',
      role: 'reviewer',
    });
    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    const submitSpy = jest.spyOn(SumsubAdapter.prototype, 'submit').mockResolvedValue({
      providerApplicantId: 'mock-applicant-id',
      hostedLinkUrl: 'https://in.sumsub.com/websdk/p/mock-token',
    });

    const initiated = await initiateVerification(broker.ctx, {
      kind: 'individual',
      brokerProfileId: broker.id,
      firstName: 'Verify',
      lastName: 'Broker',
    });
    expect(initiated.hostedLinkUrl).toBe('https://in.sumsub.com/websdk/p/mock-token');
    expect(await statusOf('broker_profiles', broker.id)).toBe('in_verification');

    await recordWebhookResult({
      applicantId: 'mock-applicant-id',
      externalUserId: broker.id,
      type: 'applicantReviewed',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    const { rows: checkResults } = await withAuthorizationContext(systemCtx, (client) =>
      client.query(`SELECT outcome, job_status FROM check_result WHERE subject_type = 'broker_profile' AND subject_id = $1 AND valid_to IS NULL`, [
        broker.id,
      ]),
    );
    expect(checkResults).toHaveLength(1);
    expect(checkResults[0].outcome).toBe('GREEN');
    expect(checkResults[0].job_status).toBe('completed');

    const checkResultId = (
      await withAuthorizationContext(systemCtx, (client) =>
        client.query(`SELECT id FROM check_result WHERE subject_type = 'broker_profile' AND subject_id = $1 AND valid_to IS NULL`, [broker.id]),
      )
    ).rows[0].id as string;

    const reviewerCtx: AuthorizationContext = { actorType: 'client_user', actorId: reviewer.id, clientOrganisationId: org.id };
    await reviewerDecide(reviewerCtx, checkResultId, 'approve');
    expect(await statusOf('broker_profiles', broker.id)).toBe('verified');

    submitSpy.mockRestore();
  });

  it('lands on attention_required when the reviewer declines', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-b`);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Verify Lender B ${suffix}` });
    const reviewer = await createClientUser(systemCtx, {
      clientOrganisationId: org.id,
      email: `verify-reviewer-b-${suffix}@example.com`,
      password: 'dev-password-123456',
      role: 'reviewer',
    });
    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    const submitSpy = jest.spyOn(SumsubAdapter.prototype, 'submit').mockResolvedValue({
      providerApplicantId: 'mock-applicant-id-2',
    });

    await initiateVerification(broker.ctx, { kind: 'individual', brokerProfileId: broker.id, firstName: 'Verify', lastName: 'Broker' });
    await recordWebhookResult({ externalUserId: broker.id, reviewResult: { reviewAnswer: 'RED' } });

    const checkResultId = (
      await withAuthorizationContext(systemCtx, (client) =>
        client.query(`SELECT id FROM check_result WHERE subject_type = 'broker_profile' AND subject_id = $1 AND valid_to IS NULL`, [broker.id]),
      )
    ).rows[0].id as string;

    const reviewerCtx: AuthorizationContext = { actorType: 'client_user', actorId: reviewer.id, clientOrganisationId: org.id };
    await reviewerDecide(reviewerCtx, checkResultId, 'decline');
    expect(await statusOf('broker_profiles', broker.id)).toBe('attention_required');

    submitSpy.mockRestore();
  });
});

describe('KYB lifecycle (MockKybAdapter, no HTTP to mock)', () => {
  it('applies a result synchronously and reaches verified on approve', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(`${suffix}-kyb`);
    const business = await createBusiness(broker.ctx, broker.id, { entityType: 'company', legalName: `Verify Co ${suffix}` });
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Verify Lender KYB ${suffix}` });
    const reviewer = await createClientUser(systemCtx, {
      clientOrganisationId: org.id,
      email: `verify-reviewer-kyb-${suffix}@example.com`,
      password: 'dev-password-123456',
      role: 'reviewer',
    });
    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    await initiateVerification(broker.ctx, { kind: 'business', brokerBusinessId: business.id, legalName: `Verify Co ${suffix}` });
    expect(await statusOf('broker_businesses', business.id)).toBe('in_verification');

    const { rows: checkResults } = await withAuthorizationContext(systemCtx, (client) =>
      client.query(`SELECT id, outcome, provider FROM check_result WHERE subject_type = 'broker_business' AND subject_id = $1 AND valid_to IS NULL`, [
        business.id,
      ]),
    );
    expect(checkResults).toHaveLength(1);
    expect(checkResults[0].provider).toBe('mock-kyb');
    expect(checkResults[0].outcome).toBe('GREEN');

    const reviewerCtx: AuthorizationContext = { actorType: 'client_user', actorId: reviewer.id, clientOrganisationId: org.id };
    await reviewerDecide(reviewerCtx, checkResults[0].id, 'approve');
    expect(await statusOf('broker_businesses', business.id)).toBe('verified');
  });
});

afterAll(async () => {
  await pool.end();
});
