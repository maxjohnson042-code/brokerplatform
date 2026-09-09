import { createHash, randomUUID } from 'crypto';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { ObjectStorage, LocalFilesystemObjectStorage } from './object-storage';
import { DocumentSubjectType, catalogForSubjectType } from './document-catalog';

const RETENTION_YEARS = 7; // NFR-PRV-4

const defaultStorage = new LocalFilesystemObjectStorage();

export type EvidenceSubjectType = 'broker_profile' | 'broker_business' | 'business_principal';

/**
 * Section 2.4 / Section 20.4: writes the raw provider payload to object storage,
 * content-hashes it (AUD-006), and records metadata + the hash in Postgres. The
 * payload itself never touches a database column — this is the mechanism, not just a
 * convention, that keeps "verified: yes" from ever being the only thing stored.
 *
 * Runs as 'system' because evidence is written by the verification pipeline on its
 * own authority (see the RLS comment on the evidence table in migration 0007) —
 * neither a broker nor a client user ever calls this directly.
 */
export async function storeEvidence(
  input: {
    subjectType: EvidenceSubjectType;
    subjectId: string;
    source: string; // e.g. 'sumsub'
    method: string; // e.g. 'kyc_individual'
    payload: Buffer; // the raw, untouched provider response
  },
  storage: ObjectStorage = defaultStorage,
): Promise<{ id: string; contentHash: string }> {
  const contentHash = createHash('sha256').update(input.payload).digest('hex');
  const objectKey = `${input.subjectType}/${input.subjectId}/${randomUUID()}.json`;

  await storage.put(objectKey, input.payload);

  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const retainedUntil = new Date();
    retainedUntil.setFullYear(retainedUntil.getFullYear() + RETENTION_YEARS);

    const { rows } = await client.query(
      `INSERT INTO evidence
         (subject_type, subject_id, source, method, object_key, content_hash, retained_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.subjectType,
        input.subjectId,
        input.source,
        input.method,
        objectKey,
        contentHash,
        retainedUntil.toISOString(),
      ],
    );
    const id = rows[0].id as string;

    await recordAuditEvent(client, {
      actorType: 'system',
      action: 'evidence.captured',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      detail: { evidenceId: id, source: input.source, method: input.method, contentHash },
    });

    return { id, contentHash };
  });
}

// ---------------------------------------------------------------------------
// DOC-001/002/006: broker-uploaded documents. A document is evidence with richer
// structured metadata (document_type/issue_date/expiry_date/issuing_body/mime_type/
// original_filename) — same table, same object-storage seam, same 7-year retention.
// ---------------------------------------------------------------------------

export type UploadDocumentInput = {
  subjectType: DocumentSubjectType;
  subjectId: string;
  documentType: string;
  file: Buffer;
  mimeType: string;
  originalFilename: string;
  issueDate?: string; // ISO date
  expiryDate?: string; // ISO date — explicit override; else derived from the catalog's defaultValidityDays
  issuingBody?: string;
  uploadedBy: { actorType: 'broker'; actorId: string };
};

function deriveExpiryDate(input: UploadDocumentInput): string | null {
  if (input.expiryDate) return input.expiryDate;
  if (!input.issueDate) return null;
  const entry = catalogForSubjectType(input.subjectType).find((e) => e.documentType === input.documentType);
  if (!entry?.defaultValidityDays) return null;
  const issued = new Date(input.issueDate);
  issued.setDate(issued.getDate() + entry.defaultValidityDays);
  return issued.toISOString().slice(0, 10);
}

/**
 * DOC-006: always supersedes any current row of the same (subjectType, subjectId,
 * documentType) rather than overwriting it — identical transaction shape to
 * recordCheckResult (check-result.repository.ts): insert the new row, then close the
 * old one out (valid_to + superseded_by) in the same transaction. Runs as 'system',
 * same as storeEvidence above — evidence_insert's RLS policy is system/platform_admin
 * only by design (see migration 0007's comment on that policy); the caller
 * (evidence.controller.ts) is responsible for checking the broker is actually
 * entitled to write for this subject BEFORE calling this function, the same "app
 * layer decides, system authority executes" split Section 20.2 uses throughout.
 */
export async function uploadDocument(input: UploadDocumentInput): Promise<{ id: string }> {
  const contentHash = createHash('sha256').update(input.file).digest('hex');
  const objectKey = `${input.subjectType}/${input.subjectId}/${input.documentType}/${randomUUID()}`;
  const expiryDate = deriveExpiryDate(input);

  await defaultStorage.put(objectKey, input.file);

  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const retainedUntil = new Date();
    retainedUntil.setFullYear(retainedUntil.getFullYear() + RETENTION_YEARS);

    const { rows: current } = await client.query(
      `SELECT id FROM evidence
       WHERE subject_type = $1 AND subject_id = $2 AND document_type = $3 AND valid_to IS NULL`,
      [input.subjectType, input.subjectId, input.documentType],
    );

    const { rows: inserted } = await client.query(
      `INSERT INTO evidence
         (subject_type, subject_id, source, method, object_key, content_hash, retained_until,
          document_type, issue_date, expiry_date, issuing_body, mime_type, original_filename)
       VALUES ($1, $2, 'broker_upload', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        input.subjectType,
        input.subjectId,
        input.documentType,
        objectKey,
        contentHash,
        retainedUntil.toISOString(),
        input.documentType,
        input.issueDate ?? null,
        expiryDate,
        input.issuingBody ?? null,
        input.mimeType,
        input.originalFilename,
      ],
    );
    const newId = inserted[0].id as string;

    if (current.length > 0) {
      await client.query(`UPDATE evidence SET valid_to = now(), superseded_by = $1 WHERE id = $2`, [
        newId,
        current[0].id,
      ]);
    }

    await recordAuditEvent(client, {
      actorType: input.uploadedBy.actorType,
      actorId: input.uploadedBy.actorId,
      action: 'evidence.document_uploaded',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      detail: { evidenceId: newId, documentType: input.documentType, contentHash, supersedes: current[0]?.id ?? null },
    });

    return { id: newId };
  });
}

/** Current (non-superseded) documents for a subject — RLS (the fixed evidence_visibility, migration 0020) is the actual gate. */
export async function listCurrentDocuments(
  ctx: AuthorizationContext,
  subjectType: DocumentSubjectType,
  subjectId: string,
): Promise<Array<Record<string, unknown>>> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, document_type, issue_date, expiry_date, issuing_body, mime_type, original_filename, captured_at
       FROM evidence
       WHERE subject_type = $1 AND subject_id = $2 AND valid_to IS NULL AND document_type IS NOT NULL
       ORDER BY document_type`,
      [subjectType, subjectId],
    );
    return rows;
  });
}

/**
 * AUD-007: every client access to evidence is logged at record level. Logged inline,
 * in the same transaction as the read, rather than a second call after the fact —
 * one logical "view" event, one transaction, no crash-between-read-and-log gap. Only
 * logged when a client_user is the one downloading — a broker retrieving their own
 * document isn't cross-org access worth logging (this is what AUD-003's "which
 * organisations viewed what" is about).
 */
export async function getDocumentForDownload(
  ctx: AuthorizationContext,
  evidenceId: string,
): Promise<{ buffer: Buffer; mimeType: string; originalFilename: string } | null> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT object_key, mime_type, original_filename FROM evidence WHERE id = $1`,
      [evidenceId],
    );
    if (rows.length === 0) return null;

    if (ctx.actorType === 'client_user') {
      await recordAuditEvent(client, {
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        action: 'evidence.viewed',
        subjectType: 'evidence',
        subjectId: evidenceId,
        clientOrganisationId: ctx.clientOrganisationId,
      });
    }

    const buffer = await defaultStorage.get(rows[0].object_key as string);
    return {
      buffer,
      mimeType: (rows[0].mime_type as string) ?? 'application/octet-stream',
      originalFilename: (rows[0].original_filename as string) ?? 'document',
    };
  });
}

export type DocumentOutstandingItem = { field: string; reason: string };

/** Pure — factored out so it's directly testable without a database, same shape as brokers/businesses' computeOutstandingItems. */
export function computeDocumentOutstandingItems(
  subjectType: DocumentSubjectType,
  currentDocs: Array<{ document_type: string; expiry_date: string | null }>,
  context: { experienceYears: number | null },
): DocumentOutstandingItem[] {
  const items: DocumentOutstandingItem[] = [];
  const byType = new Map(currentDocs.map((d) => [d.document_type, d]));

  for (const entry of catalogForSubjectType(subjectType)) {
    if (entry.isRequired && !entry.isRequired(context)) continue;

    const doc = byType.get(entry.documentType);
    if (!doc) {
      items.push({ field: entry.documentType, reason: `${entry.label} has not been uploaded.` });
      continue;
    }
    if (doc.expiry_date && new Date(doc.expiry_date) < new Date()) {
      items.push({ field: entry.documentType, reason: `${entry.label} has expired and needs to be renewed.` });
    }
  }

  return items;
}

/** DOC-001: missing or expired required documents, with why. */
export async function getOutstandingDocumentItems(
  ctx: AuthorizationContext,
  subjectType: DocumentSubjectType,
  subjectId: string,
): Promise<DocumentOutstandingItem[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows: docs } = await client.query(
      `SELECT document_type, expiry_date FROM evidence
       WHERE subject_type = $1 AND subject_id = $2 AND valid_to IS NULL AND document_type IS NOT NULL`,
      [subjectType, subjectId],
    );

    let experienceYears: number | null = null;
    if (subjectType === 'broker_profile') {
      const { rows: profileRows } = await client.query(
        `SELECT experience_years FROM broker_profiles WHERE id = $1`,
        [subjectId],
      );
      experienceYears =
        profileRows[0]?.experience_years !== undefined && profileRows[0]?.experience_years !== null
          ? Number(profileRows[0].experience_years)
          : null;
    }

    return computeDocumentOutstandingItems(
      subjectType,
      docs as Array<{ document_type: string; expiry_date: string | null }>,
      { experienceYears },
    );
  });
}
