/**
 * Proves migration 0027's audit_log RLS is real, not decorative: audit_log had no
 * RLS at all before this migration (confirmed by grepping every prior migration for
 * ENABLE ROW LEVEL SECURITY / CREATE POLICY on it — nothing). Broker A must see their
 * own evidence.viewed and accreditation rows, never broker B's; and an INSERT under
 * no actor context at all must be denied (the FORCE RLS + explicit-enum INSERT
 * policy, not a bare WITH CHECK (true)).
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext, AuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation } from '../../src/modules/identity/identity.repository';
import { createBusiness } from '../../src/modules/businesses/businesses.repository';
import { requestRelationship } from '../../src/modules/relationships/relationships.repository';
import { requestAccreditation } from '../../src/modules/accreditation/accreditation.repository';
import { uploadDocument, getDocumentForDownload } from '../../src/modules/evidence/evidence.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({
    email: `audit-rls-${suffix}@example.com`,
    password: 'dev-password-123456',
    firstName: 'Audit',
    lastName: 'Broker',
  });
  return { id: broker.id, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function queryAuditLog(ctx: AuthorizationContext, subjectType: string, subjectId: string) {
  return withAuthorizationContext(ctx, (client) =>
    client.query(`SELECT * FROM audit_log WHERE subject_type = $1 AND subject_id = $2`, [subjectType, subjectId]),
  );
}

describe('audit_log row-level security (migration 0027)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it("a broker cannot see another broker's evidence.viewed rows, only their own", async () => {
    const suffix = Date.now().toString();
    const a = await seedBroker(`${suffix}-a`);
    const b = await seedBroker(`${suffix}-b`);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Audit RLS Lender ${suffix}` });

    const doc = await uploadDocument({
      subjectType: 'broker_profile',
      subjectId: a.id,
      documentType: 'certificate_iv',
      file: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'cert.pdf',
      uploadedBy: { actorType: 'broker', actorId: a.id },
    });

    await requestRelationship(a.ctx, {
      brokerProfileId: a.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });

    const clientCtx: AuthorizationContext = { actorType: 'client_user', actorId: org.id, clientOrganisationId: org.id };
    await getDocumentForDownload(clientCtx, doc.id);

    const asA = await queryAuditLog(a.ctx, 'evidence', doc.id);
    expect(asA.rows).toHaveLength(1);
    expect(asA.rows[0].action).toBe('evidence.viewed');

    const asB = await queryAuditLog(b.ctx, 'evidence', doc.id);
    expect(asB.rows).toHaveLength(0);
  });

  it("a broker cannot see another broker's accreditation audit rows, only their own", async () => {
    const suffix = Date.now().toString();
    const a = await seedBroker(`${suffix}-a`);
    const b = await seedBroker(`${suffix}-b`);
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Audit RLS Lender 2 ${suffix}` });
    const business = await createBusiness(a.ctx, a.id, { entityType: 'company', legalName: `Audit RLS Co ${suffix}` });
    await requestRelationship(a.ctx, {
      brokerProfileId: a.id,
      clientOrganisationId: org.id,
      type: 'lender_panel',
      consentVersion: 'v1',
    });
    const accreditation = await requestAccreditation(a.ctx, {
      brokerProfileId: a.id,
      lenderClientOrganisationId: org.id,
      brokerBusinessId: business.id,
      classification: 'new_broker_introducer',
      brand: 'default',
      role: 'broker',
      productScope: 'commercial',
      licenceHolderType: 'broking_business',
      licenceHolderBrokerBusinessId: business.id,
    });

    const asA = await queryAuditLog(a.ctx, 'accreditation', accreditation.id);
    expect(asA.rows.length).toBeGreaterThan(0);
    expect(asA.rows[0].action).toBe('accreditation.requested');

    const asB = await queryAuditLog(b.ctx, 'accreditation', accreditation.id);
    expect(asB.rows).toHaveLength(0);
  });

  it('denies an INSERT made with no actor context set at all', async () => {
    const client = await pool.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO audit_log (actor_type, actor_id, action, subject_type, subject_id) VALUES ('broker', gen_random_uuid(), 'test.no_context', 'broker_profile', gen_random_uuid())`,
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      client.release();
    }
  });
});
