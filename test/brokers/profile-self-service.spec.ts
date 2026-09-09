/**
 * Epic 13 — PRF-003 (outstanding-summary), AUD-003 (access-history), AUD-005
 * (point-in-time reconstruction). Repository-level, same style as
 * test/evidence/evidence-visibility-rls.spec.ts — no HTTP layer needed since the
 * controller endpoints are plain pass-throughs.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext, AuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';
import { requestAccreditation, approve } from '../../src/modules/accreditation/accreditation.repository';
import { confirmTraining, activateAccreditation } from '../../src/modules/accreditation/training.repository';
import { uploadDocument, getDocumentForDownload } from '../../src/modules/evidence/evidence.repository';
import { listAccessHistory, getOutstandingSummary, reconstructAsOf } from '../../src/modules/brokers/brokers.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `profile-self-service-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Self',
    lastName: 'Service',
  });
  return { id: broker.id, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

describe('broker profile self-service (Epic 13)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it("downloading a document as a client_user logs an access-history entry visible to the broker, but the broker's own download does not", async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `PSS Lender ${suffix}` });

    const doc = await uploadDocument({
      subjectType: 'broker_profile',
      subjectId: broker.id,
      documentType: 'certificate_iv',
      file: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'cert.pdf',
      uploadedBy: { actorType: 'broker', actorId: broker.id },
    });

    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    const clientCtx: AuthorizationContext = { actorType: 'client_user', actorId: org.id, clientOrganisationId: org.id };
    await getDocumentForDownload(clientCtx, doc.id);
    await getDocumentForDownload(broker.ctx, doc.id);

    const history = await listAccessHistory(broker.ctx, broker.id);
    expect(history).toHaveLength(1);
    expect(history[0].organisation_name).toBe(`PSS Lender ${suffix}`);
    expect(history[0].document_type).toBe('certificate_iv');
  });

  it('outstanding-summary combines profile + active business + accreditation sources, and skips a non-active affiliation without throwing', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `PSS Lender 2 ${suffix}` });

    const activeBusiness = await createBusiness(broker.ctx, broker.id, {
      entityType: 'company',
      legalName: `PSS Active Co ${suffix}`,
      // Deliberately no ABN/GST/address — computeBusinessOutstandingItems should flag these.
    });

    const pendingBusiness = await createBusiness(broker.ctx, broker.id, {
      entityType: 'company',
      legalName: `PSS Pending Co ${suffix}`,
      abn: '51824753556',
      gstRegistered: true,
      businessEmail: 'office@pending.example',
      address: { line1: '1 Test St', city: 'Sydney', postcode: '2000', state: 'NSW' },
    });
    // Force this one out of 'active' to simulate a not-yet-confirmed affiliation —
    // getOutstandingSummary must skip it rather than throw BusinessNotFoundError.
    await withAuthorizationContext(systemCtx, (client) =>
      client.query(`UPDATE business_affiliations SET status = 'pending_confirmation' WHERE broker_business_id = $1`, [
        pendingBusiness.id,
      ]),
    );

    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });
    await requestAccreditation(broker.ctx, {
      brokerProfileId: broker.id,
      lenderClientOrganisationId: org.id,
      brokerBusinessId: activeBusiness.id,
      classification: 'new_broker_introducer',
      brand: 'default',
      role: 'broker',
      productScope: 'commercial',
      licenceHolderType: 'broking_business',
      licenceHolderBrokerBusinessId: activeBusiness.id,
    });

    const summary = await getOutstandingSummary(broker.ctx, broker.id);

    expect(summary.some((i) => i.source === 'profile')).toBe(true);
    expect(summary.some((i) => i.source === 'business' && i.sourceId === activeBusiness.id)).toBe(true);
    expect(summary.some((i) => i.sourceId === pendingBusiness.id)).toBe(false);
    // No ruleset is configured for this lender/brand/role/scope, so the accreditation
    // contributes nothing — just proving the loop didn't throw on it either.
    expect(summary.every((i) => i.source !== 'accreditation')).toBe(true);
  });

  it('reconstruction excludes an accreditation before it existed, and reflects status as of each later date', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `PSS Lender 3 ${suffix}` });
    const business = await createBusiness(broker.ctx, broker.id, { entityType: 'company', legalName: `PSS Co 3 ${suffix}` });
    await requestRelationship(broker.ctx, {
      brokerProfileId: broker.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    const beforeRequest = new Date();

    const accreditation = await requestAccreditation(broker.ctx, {
      brokerProfileId: broker.id,
      lenderClientOrganisationId: org.id,
      brokerBusinessId: business.id,
      classification: 'new_broker_introducer',
      brand: 'default',
      role: 'broker',
      productScope: 'commercial',
      licenceHolderType: 'broking_business',
      licenceHolderBrokerBusinessId: business.id,
    });
    const afterRequest = new Date();

    const reviewerCtx: AuthorizationContext = { actorType: 'client_user', actorId: org.id, clientOrganisationId: org.id };
    await approve(reviewerCtx, accreditation.id, 'looks good');
    const afterApprove = new Date();

    await confirmTraining(reviewerCtx, accreditation.id, 'platform');
    await confirmTraining(reviewerCtx, accreditation.id, 'product');
    await activateAccreditation(reviewerCtx, accreditation.id);
    const afterActivate = new Date();

    const beforeExisted = await reconstructAsOf(broker.ctx, broker.id, beforeRequest);
    expect(beforeExisted.accreditations.find((a) => a.id === accreditation.id)).toBeUndefined();

    const asRequested = await reconstructAsOf(broker.ctx, broker.id, afterRequest);
    expect(asRequested.accreditations.find((a) => a.id === accreditation.id)?.status).toBe('requested');

    const asPending = await reconstructAsOf(broker.ctx, broker.id, afterApprove);
    expect(asPending.accreditations.find((a) => a.id === accreditation.id)?.status).toBe('pending');

    const asActive = await reconstructAsOf(broker.ctx, broker.id, afterActivate);
    expect(asActive.accreditations.find((a) => a.id === accreditation.id)?.status).toBe('active');
  });
});
