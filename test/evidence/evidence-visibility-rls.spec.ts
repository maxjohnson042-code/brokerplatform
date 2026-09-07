/**
 * Proves migration 0020's evidence_visibility fix: the same bug class Epic 4 fixed in
 * broker_businesses_visibility (a merely-pending, unconfirmed affiliation satisfying
 * `ended_at IS NULL`), PLUS a gap this epic is the first to actually exercise — there
 * was no branch at all letting a broker see evidence attached to their own business.
 * Calls the repository layer directly, same style as
 * test/businesses/business-affiliations-rls.spec.ts.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker } from '../../src/modules/identity/identity.repository';
import { createBusiness, requestAffiliation, confirmAffiliation } from '../../src/modules/businesses/businesses.repository';
import { uploadDocument, listCurrentDocuments } from '../../src/modules/evidence/evidence.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `evidence-rls-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Test',
    lastName: 'Broker',
  });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function markVerified(businessId: string) {
  await withAuthorizationContext(systemCtx, (client) =>
    client.query(`UPDATE broker_businesses SET status = 'verified' WHERE id = $1`, [businessId]),
  );
}

describe('evidence row-level security (migration 0020)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a broker can see their own broker_profile evidence but not another broker\'s', async () => {
    const suffix = Date.now().toString();
    const a = await seedBroker(`${suffix}-a`);
    const b = await seedBroker(`${suffix}-b`);

    await uploadDocument({
      subjectType: 'broker_profile',
      subjectId: a.broker.id,
      documentType: 'certificate_iv',
      file: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'cert.pdf',
      uploadedBy: { actorType: 'broker', actorId: a.broker.id },
    });

    const ownDocs = await listCurrentDocuments(a.ctx, 'broker_profile', a.broker.id);
    expect(ownDocs).toHaveLength(1);

    const othersDocs = await listCurrentDocuments(b.ctx, 'broker_profile', a.broker.id);
    expect(othersDocs).toHaveLength(0);
  });

  it('a broker with no affiliation to a business sees none of its evidence', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const outsider = await seedBroker(`${suffix}-outsider`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'RLS Evidence Co' });
    await uploadDocument({
      subjectType: 'broker_business',
      subjectId: business.id,
      documentType: 'pi_certificate',
      file: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'pi.pdf',
      uploadedBy: { actorType: 'broker', actorId: founder.broker.id },
    });

    const asOutsider = await listCurrentDocuments(outsider.ctx, 'broker_business', business.id);
    expect(asOutsider).toHaveLength(0);

    const asFounder = await listCurrentDocuments(founder.ctx, 'broker_business', business.id);
    expect(asFounder).toHaveLength(1);
  });

  it('a PENDING (unconfirmed) affiliation grants no evidence visibility — the specific gap this epic fixes', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const joiner = await seedBroker(`${suffix}-joiner`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'RLS Pending Co' });
    await markVerified(business.id);
    await uploadDocument({
      subjectType: 'broker_business',
      subjectId: business.id,
      documentType: 'pi_certificate',
      file: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'pi.pdf',
      uploadedBy: { actorType: 'broker', actorId: founder.broker.id },
    });

    await requestAffiliation(joiner.ctx, joiner.broker.id, business.id);
    // Before migration 0020, `ba.ended_at IS NULL` was true for this pending row too,
    // so this would incorrectly return the evidence. It must not.
    const beforeConfirm = await listCurrentDocuments(joiner.ctx, 'broker_business', business.id);
    expect(beforeConfirm).toHaveLength(0);
  });

  it('an actively-affiliated broker sees their own business\'s evidence — could not happen at all before this migration', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const joiner = await seedBroker(`${suffix}-joiner`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'RLS Active Co' });
    await markVerified(business.id);
    await uploadDocument({
      subjectType: 'broker_business',
      subjectId: business.id,
      documentType: 'pi_certificate',
      file: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'pi.pdf',
      uploadedBy: { actorType: 'broker', actorId: founder.broker.id },
    });

    const pending = await requestAffiliation(joiner.ctx, joiner.broker.id, business.id);
    await confirmAffiliation(founder.ctx, founder.broker.id, business.id, pending.id);

    const afterConfirm = await listCurrentDocuments(joiner.ctx, 'broker_business', business.id);
    expect(afterConfirm).toHaveLength(1);
  });

  it('a raw query as an unaffiliated broker returns zero rows, proving RLS itself blocks it (not just listCurrentDocuments\' own filtering)', async () => {
    const suffix = Date.now().toString();
    const founder = await seedBroker(`${suffix}-founder`);
    const outsider = await seedBroker(`${suffix}-outsider`);

    const business = await createBusiness(founder.ctx, founder.broker.id, { entityType: 'company', legalName: 'RLS Raw Co' });
    await uploadDocument({
      subjectType: 'broker_business',
      subjectId: business.id,
      documentType: 'pi_certificate',
      file: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'pi.pdf',
      uploadedBy: { actorType: 'broker', actorId: founder.broker.id },
    });

    const raw = await withAuthorizationContext(outsider.ctx, (client) =>
      client.query(`SELECT id FROM evidence WHERE subject_type = 'broker_business' AND subject_id = $1`, [business.id]),
    );
    expect(raw.rows).toHaveLength(0);
  });
});
