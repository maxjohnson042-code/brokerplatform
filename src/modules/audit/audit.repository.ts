import { PoolClient } from 'pg';

export type AuditEvent = {
  actorType: 'broker' | 'client_user' | 'platform_admin' | 'system';
  actorId?: string;
  action: string; // e.g. 'relationship.consented', 'evidence.viewed'
  subjectType: string;
  subjectId: string;
  clientOrganisationId?: string;
  detail?: Record<string, unknown>;
  reason?: string;
};

/**
 * Section 20.5 / non-negotiable #5 (Section 25): "written in the same transaction as
 * the change it records... an audit record that can be lost independently of the
 * change is not an audit record."
 *
 * This takes a `client` — the SAME PoolClient a caller got from
 * withAuthorizationContext — rather than opening its own connection or transaction.
 * That is the whole mechanism: call this in the middle of another module's
 * transaction, right alongside the domain write it's recording, and it commits or
 * rolls back atomically with it. Never call this with a fresh pool.connect().
 */
export async function recordAuditEvent(client: PoolClient, event: AuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (actor_type, actor_id, action, subject_type, subject_id, client_organisation_id, detail, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.actorType,
      event.actorId ?? null,
      event.action,
      event.subjectType,
      event.subjectId,
      event.clientOrganisationId ?? null,
      JSON.stringify(event.detail ?? {}),
      event.reason ?? null,
    ],
  );
}
