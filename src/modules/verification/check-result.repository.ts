import { withAuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';

export type CheckSubjectType = 'broker_profile' | 'broker_business';

/**
 * The worked example from Section 20.3, implemented: "Current state is a view
 * (valid_to IS NULL)... superseded only by a new Evidence record." Recording a check
 * result NEVER issues an UPDATE against an existing valid row's outcome — it closes
 * the old row (valid_to + superseded_by) and inserts a new one, atomically. Every
 * caller (the Sumsub adapter, a register-lookup adapter, a manual reviewer action)
 * goes through this function rather than writing to check_result directly, so this is
 * the one place the temporal invariant has to be got right.
 */
export async function recordCheckResult(input: {
  subjectType: CheckSubjectType;
  subjectId: string;
  checkType: string; // from the Section 7.1 catalogue
  provider: string; // 'sumsub' | a register name | 'manual'
  outcome: string;
  evidenceId?: string;
  jobStatus?: 'requested' | 'in_flight' | 'completed' | 'failed' | 'timed_out';
}): Promise<{ id: string }> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows: current } = await client.query(
      `SELECT id FROM check_result
       WHERE subject_type = $1 AND subject_id = $2 AND check_type = $3 AND valid_to IS NULL`,
      [input.subjectType, input.subjectId, input.checkType],
    );

    const { rows: inserted } = await client.query(
      `INSERT INTO check_result
         (subject_type, subject_id, check_type, provider, outcome, evidence_id, job_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.subjectType,
        input.subjectId,
        input.checkType,
        input.provider,
        input.outcome,
        input.evidenceId ?? null,
        input.jobStatus ?? 'completed',
      ],
    );
    const newId = inserted[0].id as string;

    if (current.length > 0) {
      await client.query(
        `UPDATE check_result SET valid_to = now(), superseded_by = $1 WHERE id = $2`,
        [newId, current[0].id],
      );
    }

    await recordAuditEvent(client, {
      actorType: 'system',
      action: 'check_result.recorded',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      detail: { checkType: input.checkType, provider: input.provider, outcome: input.outcome, checkResultId: newId },
    });

    return { id: newId };
  });
}
