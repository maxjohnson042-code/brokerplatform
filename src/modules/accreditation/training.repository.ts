import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { getAccreditationOrThrow, assertClientUserOrSystem, actorIdOf, InvalidAccreditationTransitionError } from './accreditation.repository';

export type TrainingKind = 'platform' | 'product';

export type TrainingConfirmation = {
  id: string;
  accreditation_id: string;
  kind: TrainingKind;
  confirmed_at: string;
  confirmed_by_client_user_id: string | null;
  notes: string | null;
  created_at: string;
};

/**
 * Epic 11: no in-platform training content, no broker self-report — the lender
 * confirms a broker's relevant training happened off-platform. Idempotent-insert
 * (ON CONFLICT DO NOTHING) rather than an upsert: this table only has SELECT/INSERT
 * grants (migration 0025), a re-confirmation of the same kind is a no-op, not an
 * edit — there's no product requirement for changing a confirmation once made.
 */
export async function confirmTraining(
  ctx: AuthorizationContext,
  accreditationId: string,
  kind: TrainingKind,
  notes?: string,
): Promise<void> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);

    await client.query(
      `INSERT INTO training_confirmations (accreditation_id, kind, confirmed_by_client_user_id, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (accreditation_id, kind) DO NOTHING`,
      [accreditationId, kind, actorIdOf(ctx) ?? null, notes ?? null],
    );
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.training_confirmed',
      subjectType: 'accreditation',
      subjectId: accreditationId,
      clientOrganisationId: accreditation.lender_client_organisation_id,
      detail: { kind, notes: notes ?? null },
    });
  });
}

/**
 * TRN-006's actual trigger — an explicit, independent lender action, not an automatic
 * consequence of confirmations existing. "Relevant" training is the lender's own
 * judgement (per the Epic 11 plan's Scope decision), so the platform doesn't count
 * confirmations before allowing this.
 */
export async function activateAccreditation(ctx: AuthorizationContext, accreditationId: string): Promise<void> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const accreditation = await getAccreditationOrThrow(client, accreditationId);
    if (accreditation.status !== 'pending') {
      throw new InvalidAccreditationTransitionError(accreditation.status, 'activate');
    }

    await client.query(`UPDATE accreditations SET status = 'active', activated_at = now(), updated_at = now() WHERE id = $1`, [accreditationId]);
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'accreditation.activated',
      subjectType: 'accreditation',
      subjectId: accreditationId,
      clientOrganisationId: accreditation.lender_client_organisation_id,
    });
  });
}

export async function listConfirmations(ctx: AuthorizationContext, accreditationId: string): Promise<TrainingConfirmation[]> {
  return withAuthorizationContext(ctx, async (client) => {
    await getAccreditationOrThrow(client, accreditationId); // RLS-scoped existence/visibility check
    const { rows } = await client.query<TrainingConfirmation>(
      `SELECT * FROM training_confirmations WHERE accreditation_id = $1 ORDER BY confirmed_at ASC`,
      [accreditationId],
    );
    return rows;
  });
}

/**
 * TRN-008, explicit and callable — not scheduled (see the Epic 11 plan's Scope
 * decision: nothing in this codebase runs on a timer). The natural hook point for a
 * future scheduler to call, not a permanent limitation.
 */
export async function checkTrainingDeadlines(ctx: AuthorizationContext, lenderClientOrganisationId: string): Promise<string[]> {
  assertClientUserOrSystem(ctx);
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE accreditations
       SET status = 'lapsed', updated_at = now()
       WHERE lender_client_organisation_id = $1 AND status = 'pending'
         AND training_deadline_at IS NOT NULL AND training_deadline_at < now()
       RETURNING id`,
      [lenderClientOrganisationId],
    );
    for (const row of rows) {
      await recordAuditEvent(client, {
        actorType: ctx.actorType,
        actorId: actorIdOf(ctx),
        action: 'accreditation.lapsed',
        subjectType: 'accreditation',
        subjectId: row.id,
        clientOrganisationId: lenderClientOrganisationId,
        detail: { reason: 'training deadline missed' },
      });
    }
    return rows.map((r) => r.id);
  });
}
