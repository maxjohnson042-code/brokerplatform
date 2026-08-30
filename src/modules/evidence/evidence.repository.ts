import { createHash, randomUUID } from 'crypto';
import { withAuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { ObjectStorage, LocalFilesystemObjectStorage } from './object-storage';

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

/**
 * IDV-013 / AUD-007: every client access to evidence is logged at record level. Call
 * this from whatever read path serves evidence to a client_user — it does not gate
 * access (RLS already does that), it only records that access happened.
 */
export async function logEvidenceAccess(
  evidenceId: string,
  by: { actorType: 'client_user' | 'broker' | 'platform_admin'; actorId: string; clientOrganisationId?: string },
): Promise<void> {
  await withAuthorizationContext(
    by.actorType === 'client_user'
      ? { actorType: 'client_user', actorId: by.actorId, clientOrganisationId: by.clientOrganisationId! }
      : { actorType: by.actorType, actorId: by.actorId },
    async (client) => {
      await recordAuditEvent(client, {
        actorType: by.actorType,
        actorId: by.actorId,
        action: 'evidence.viewed',
        subjectType: 'evidence',
        subjectId: evidenceId,
        clientOrganisationId: by.clientOrganisationId,
      });
    },
  );
}
