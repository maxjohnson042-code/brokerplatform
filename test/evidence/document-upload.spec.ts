/**
 * DOC-001/002/006/008 end to end over HTTP: upload against the required-document
 * catalog, outstanding-items shrinking as documents land, an expired document
 * counting as outstanding (not just a missing one), versioning (a new upload
 * supersedes the old one rather than duplicating it), download round-tripping the
 * original bytes, and file-type rejection.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EvidenceModule } from '../../src/modules/evidence/evidence.module';
import { BusinessesModule } from '../../src/modules/businesses/businesses.module';
import { pool } from '../../src/db/pool';

describe('document upload (DOC-001/002/006/008)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EvidenceModule, BusinessesModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function registerAndLogin(suffix: string) {
    const email = `doc-upload-${suffix}@example.com`;
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

  function isoDate(daysFromNow: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().slice(0, 10);
  }

  it('walks the full upload -> outstanding-items -> expiry -> version -> download lifecycle for a broker profile', async () => {
    const token = await registerAndLogin(`profile-${Date.now()}`);
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const initial = await auth(request(app.getHttpServer()).get('/documents/broker-profile/outstanding-items')).expect(
      200,
    );
    const initialTypes = initial.body.map((i: { field: string }) => i.field);
    expect(initialTypes).toContain('certificate_iv');
    expect(initialTypes).toContain('police_check');
    // experience_years is still null at fresh registration (Epic 3 field, not set
    // here) — the conditional mentoring_letter requirement correctly stays silent
    // until it's known to be < 2, not "unknown therefore required".
    expect(initialTypes).not.toContain('mentoring_letter');

    await auth(request(app.getHttpServer()).post('/documents/broker-profile'))
      .field('documentType', 'certificate_iv')
      .attach('file', Buffer.from('%PDF-1.4 fake cert'), { filename: 'cert-iv.pdf', contentType: 'application/pdf' })
      .expect(201);

    const afterCert = await auth(
      request(app.getHttpServer()).get('/documents/broker-profile/outstanding-items'),
    ).expect(200);
    expect(afterCert.body.map((i: { field: string }) => i.field)).not.toContain('certificate_iv');

    // Upload a police check that's already expired.
    await auth(request(app.getHttpServer()).post('/documents/broker-profile'))
      .field('documentType', 'police_check')
      .field('issueDate', isoDate(-400))
      .field('expiryDate', isoDate(-10))
      .attach('file', Buffer.from('%PDF-1.4 old police check'), {
        filename: 'police-v1.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const afterExpired = await auth(
      request(app.getHttpServer()).get('/documents/broker-profile/outstanding-items'),
    ).expect(200);
    const policeItem = afterExpired.body.find((i: { field: string }) => i.field === 'police_check');
    expect(policeItem.reason).toMatch(/expired/i);

    // Upload a fresh one — must supersede, not duplicate.
    const freshContent = '%PDF-1.4 fresh police check';
    await auth(request(app.getHttpServer()).post('/documents/broker-profile'))
      .field('documentType', 'police_check')
      .field('issueDate', isoDate(0))
      .field('expiryDate', isoDate(170))
      .attach('file', Buffer.from(freshContent), { filename: 'police-v2.pdf', contentType: 'application/pdf' })
      .expect(201);

    const list = await auth(request(app.getHttpServer()).get('/documents/broker-profile')).expect(200);
    const policeDocs = list.body.filter((d: { document_type: string }) => d.document_type === 'police_check');
    expect(policeDocs).toHaveLength(1); // superseded, not duplicated
    expect(policeDocs[0].original_filename).toBe('police-v2.pdf');

    const afterRenewal = await auth(
      request(app.getHttpServer()).get('/documents/broker-profile/outstanding-items'),
    ).expect(200);
    expect(afterRenewal.body.map((i: { field: string }) => i.field)).not.toContain('police_check');

    // Download round-trips the exact bytes of the CURRENT version. supertest buffers
    // an unrecognised content-type (application/pdf) as `.body` (a Buffer), not
    // `.text` — that's a supertest parsing detail, not something the endpoint itself
    // needs to account for.
    const download = await auth(request(app.getHttpServer()).get(`/documents/${policeDocs[0].id}/download`)).expect(
      200,
    );
    expect(Buffer.from(download.body).toString()).toBe(freshContent);
  });

  it('rejects a disallowed file type', async () => {
    const token = await registerAndLogin(`filetype-${Date.now()}`);
    await request(app.getHttpServer())
      .post('/documents/broker-profile')
      .set('Authorization', `Bearer ${token}`)
      .field('documentType', 'certificate_iv')
      .attach('file', Buffer.from('not a real document'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('a broker cannot see another broker\'s documents over HTTP', async () => {
    const tokenA = await registerAndLogin(`cross-a-${Date.now()}`);
    const tokenB = await registerAndLogin(`cross-b-${Date.now()}`);

    await request(app.getHttpServer())
      .post('/documents/broker-profile')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('documentType', 'certificate_iv')
      .attach('file', Buffer.from('%PDF-1.4 a-cert'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(201);

    const listB = await request(app.getHttpServer())
      .get('/documents/broker-profile')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(listB.body).toHaveLength(0);
  });

  it('uploads and tracks a business document (PI certificate), gated on active affiliation', async () => {
    const token = await registerAndLogin(`business-${Date.now()}`);
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const business = await auth(request(app.getHttpServer()).post('/businesses'))
      .send({ entityType: 'company', legalName: 'Doc Upload Co' })
      .expect(201);
    const businessId = business.body.id;

    const initial = await auth(
      request(app.getHttpServer()).get(`/documents/businesses/${businessId}/outstanding-items`),
    ).expect(200);
    expect(initial.body.map((i: { field: string }) => i.field)).toContain('pi_certificate');

    await auth(request(app.getHttpServer()).post(`/documents/businesses/${businessId}`))
      .field('documentType', 'pi_certificate')
      .field('issueDate', isoDate(0))
      .attach('file', Buffer.from('%PDF-1.4 pi cert'), { filename: 'pi.pdf', contentType: 'application/pdf' })
      .expect(201);

    const after = await auth(
      request(app.getHttpServer()).get(`/documents/businesses/${businessId}/outstanding-items`),
    ).expect(200);
    expect(after.body.map((i: { field: string }) => i.field)).not.toContain('pi_certificate');
  });

  it('a broker with no affiliation cannot upload a document for someone else\'s business', async () => {
    const ownerToken = await registerAndLogin(`owner-${Date.now()}`);
    const outsiderToken = await registerAndLogin(`outsider-${Date.now()}`);

    const business = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ entityType: 'company', legalName: 'Not Yours Co' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/documents/businesses/${business.body.id}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .field('documentType', 'pi_certificate')
      .attach('file', Buffer.from('%PDF-1.4 sneaky'), { filename: 'sneaky.pdf', contentType: 'application/pdf' })
      .expect(404);
  });
});
