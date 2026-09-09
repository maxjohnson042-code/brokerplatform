import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { recordAuditEvent } from '../audit/audit.repository';
import { createNotification } from '../notifications/notification.repository';
import {
  identityVerificationSubmittedTemplate,
  identityVerificationCompleteTemplate,
  identityVerificationQueueEntryTemplate,
} from '../notifications/notification-templates';
import { recordCheckResult } from './check-result.repository';
import { storeEvidence } from '../evidence/evidence.repository';
import { actorIdOf, InsufficientRoleError } from '../accreditation/accreditation.repository';
import { SumsubAdapter } from './providers/sumsub-adapter';
import { MockKybAdapter } from './providers/mock-kyb-adapter';
import { VerificationSubject, VerificationResult } from './providers/identity-verification-provider';

const sumsubAdapter = new SumsubAdapter();
const mockKybAdapter = new MockKybAdapter();

export type IdentityVerificationSubjectType = 'broker_profile' | 'broker_business';

const CHECK_TYPE_BY_SUBJECT: Record<IdentityVerificationSubjectType, string> = {
  broker_profile: 'identity_verification_kyc',
  broker_business: 'identity_verification_kyb',
};

const STATUS_TABLE: Record<IdentityVerificationSubjectType, string> = {
  broker_profile: 'broker_profiles',
  broker_business: 'broker_businesses',
};

export class VerificationNotFoundError extends Error {
  constructor(id: string) {
    super(`check result not found: ${id}`);
    this.name = 'VerificationNotFoundError';
  }
}
export class AlreadyInVerificationError extends Error {
  constructor() {
    super('a verification is already in progress for this subject');
    this.name = 'AlreadyInVerificationError';
  }
}

type NotificationDispatch = { notificationId: string; recipientEmail: string; shouldSend: boolean; subject: string; body: string };

/**
 * IDV-003/009: stores the raw payload as immutable evidence, records the check_result
 * (the one write path, per check-result.repository.ts's own comment), then notifies
 * every client_user of every lender/aggregator with an active relationship to the
 * subject — a check_result isn't scoped to one organisation, so this is the same
 * "reusable across clients" property IDV-008 asks for, not something extra to build.
 * Shared by both the real webhook path (KYC) and the mock's synchronous path (KYB) —
 * one place gets this right, same reasoning as every other shared-transaction helper
 * in this codebase.
 */
async function applyResult(
  subjectType: IdentityVerificationSubjectType,
  subjectId: string,
  checkType: string,
  provider: string,
  result: VerificationResult,
): Promise<void> {
  const evidence = await storeEvidence({
    subjectType,
    subjectId,
    source: provider,
    method: subjectType === 'broker_profile' ? 'kyc_individual' : 'kyb_business',
    payload: result.rawPayload,
  });

  await recordCheckResult({
    subjectType,
    subjectId,
    checkType,
    provider,
    outcome: result.normalisedOutcome,
    evidenceId: evidence.id,
    jobStatus: 'completed',
  });

  await withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const brokerProfileId =
      subjectType === 'broker_profile'
        ? subjectId
        : ((
            await client.query(
              `SELECT broker_profile_id FROM business_affiliations WHERE broker_business_id = $1 AND status = 'active' LIMIT 1`,
              [subjectId],
            )
          ).rows[0]?.broker_profile_id as string | undefined);
    if (!brokerProfileId) return;

    const { rows: recipientRows } = await client.query(
      `SELECT DISTINCT cu.id AS client_user_id
       FROM relationships r
       JOIN client_users cu ON cu.client_organisation_id = r.client_organisation_id AND cu.is_active = true
       WHERE r.broker_profile_id = $1 AND r.status = 'active' AND r.effective_to IS NULL`,
      [brokerProfileId],
    );
    if (recipientRows.length === 0) return;

    const { rows: profileRows } = await client.query(`SELECT first_name, last_name FROM broker_profiles WHERE id = $1`, [brokerProfileId]);
    const subjectName = profileRows[0] ? `${profileRows[0].first_name} ${profileRows[0].last_name}` : 'A broker';
    const template = identityVerificationQueueEntryTemplate({
      subjectName,
      kind: subjectType === 'broker_profile' ? 'individual' : 'business',
    });
    for (const row of recipientRows) {
      await createNotification(client, { actorType: 'system' }, {
        recipientType: 'client_user',
        recipientId: row.client_user_id,
        category: 'identity_verification_queue_entry',
        subject: template.subject,
        body: template.body,
        relatedRecordType: subjectType,
        relatedRecordId: subjectId,
      });
    }
  });
}

/** IDV-001/002: broker elects, system triggers. Broker-initiated only — ctx is always a broker's own. */
export async function initiateVerification(
  ctx: AuthorizationContext,
  subject: VerificationSubject,
): Promise<{ hostedLinkUrl?: string } & NotificationDispatch> {
  const subjectType: IdentityVerificationSubjectType = subject.kind === 'individual' ? 'broker_profile' : 'broker_business';
  const subjectId = subject.kind === 'individual' ? subject.brokerProfileId : subject.brokerBusinessId;
  const checkType = CHECK_TYPE_BY_SUBJECT[subjectType];
  const table = STATUS_TABLE[subjectType];
  const provider = subject.kind === 'individual' ? 'sumsub' : 'mock-kyb';

  await withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT status FROM ${table} WHERE id = $1`, [subjectId]);
    if (rows[0]?.status === 'in_verification') throw new AlreadyInVerificationError();
  });

  const adapter = subject.kind === 'individual' ? sumsubAdapter : mockKybAdapter;
  const submission = await adapter.submit(subject);

  await recordCheckResult({ subjectType, subjectId, checkType, provider, outcome: 'pending', jobStatus: 'requested' });

  const dispatch = await withAuthorizationContext(ctx, async (client) => {
    await client.query(`UPDATE ${table} SET status = 'in_verification', updated_at = now() WHERE id = $1`, [subjectId]);
    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'identity_verification.initiated',
      subjectType,
      subjectId,
      detail: { checkType, provider },
    });

    const template = identityVerificationSubmittedTemplate();
    const notification = await createNotification(client, ctx, {
      recipientType: 'broker',
      recipientId: actorIdOf(ctx)!,
      category: 'identity_verification_submitted',
      subject: template.subject,
      body: template.body,
      relatedRecordType: subjectType,
      relatedRecordId: subjectId,
    });
    return {
      notificationId: notification.id,
      recipientEmail: notification.recipientEmail,
      shouldSend: notification.shouldSend,
      subject: template.subject,
      body: template.body,
    };
  });

  if (subject.kind === 'business') {
    // Mocked — no real webhook will ever arrive for this branch, so the (fabricated)
    // result is applied immediately rather than parked at 'requested' forever.
    const result = await mockKybAdapter.poll(submission.providerApplicantId);
    await applyResult(subjectType, subjectId, checkType, provider, result);
  }

  return { hostedLinkUrl: submission.hostedLinkUrl, ...dispatch };
}

/**
 * The webhook handler's business logic (signature verification happens in the
 * controller, before this is called). KYC (individual) only in this epic — KYB never
 * has a real webhook to receive, see mock-kyb-adapter.ts's own comment. externalUserId
 * was set to the brokerProfileId at submission time (initiateVerification), so it's
 * the correlation key back to a real subject — no separate applicant-id table needed.
 */
export async function recordWebhookResult(payload: Record<string, unknown>): Promise<void> {
  const externalUserId = typeof payload.externalUserId === 'string' ? payload.externalUserId : null;
  if (!externalUserId) return;

  const reviewAnswer = (payload.reviewResult as { reviewAnswer?: string } | undefined)?.reviewAnswer;
  const result: VerificationResult = {
    status: reviewAnswer === 'GREEN' ? 'approved' : reviewAnswer === 'RED' ? 'declined' : 'requires_review',
    rawPayload: Buffer.from(JSON.stringify(payload)),
    normalisedOutcome: reviewAnswer ?? 'unknown',
  };

  await applyResult('broker_profile', externalUserId, CHECK_TYPE_BY_SUBJECT.broker_profile, 'sumsub', result);
}

/** IDV-005: a human reviewer's decision, distinct from whatever outcome the provider itself returned. */
export async function reviewerDecide(
  ctx: AuthorizationContext,
  checkResultId: string,
  decision: 'approve' | 'decline',
): Promise<NotificationDispatch> {
  if (ctx.actorType !== 'client_user' && ctx.actorType !== 'system') {
    throw new InsufficientRoleError('only a client organisation user may decide an identity verification result');
  }

  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT * FROM check_result WHERE id = $1`, [checkResultId]);
    if (!rows[0]) throw new VerificationNotFoundError(checkResultId);
    const subjectType = rows[0].subject_type as IdentityVerificationSubjectType;
    const subjectId = rows[0].subject_id as string;
    const table = STATUS_TABLE[subjectType];
    const newStatus = decision === 'approve' ? 'verified' : 'attention_required';

    // broker_profiles_self_write / broker_businesses_update (migrations 0007/0019)
    // grant UPDATE to system/platform_admin or the broker themselves — never
    // client_user, since nothing before this epic ever needed a client_user to write
    // into a broker's own status. Transaction-scoped escalate-and-restore, same
    // mechanism as flagPartyChanged/getOutstandingItems elsewhere in this codebase.
    await client.query(`SELECT set_config('app.actor_type', 'system', true)`);
    await client.query(`UPDATE ${table} SET status = $2, updated_at = now() WHERE id = $1`, [subjectId, newStatus]);
    await client.query(`SELECT set_config('app.actor_type', $1, true)`, [ctx.actorType]);

    const brokerProfileId =
      subjectType === 'broker_profile'
        ? subjectId
        : ((
            await client.query(
              `SELECT broker_profile_id FROM business_affiliations WHERE broker_business_id = $1 AND status = 'active' LIMIT 1`,
              [subjectId],
            )
          ).rows[0]?.broker_profile_id as string | undefined);

    await recordAuditEvent(client, {
      actorType: ctx.actorType,
      actorId: actorIdOf(ctx),
      action: 'identity_verification.decided',
      subjectType,
      subjectId,
      detail: { checkResultId, decision },
    });

    const template = identityVerificationCompleteTemplate({ approved: decision === 'approve' });
    const notification = await createNotification(client, ctx, {
      recipientType: 'broker',
      recipientId: brokerProfileId!,
      category: 'identity_verification_complete',
      subject: template.subject,
      body: template.body,
      relatedRecordType: 'check_result',
      relatedRecordId: checkResultId,
    });
    return {
      notificationId: notification.id,
      recipientEmail: notification.recipientEmail,
      shouldSend: notification.shouldSend,
      subject: template.subject,
      body: template.body,
    };
  });
}

/** IDV-006/010: full result view — provider, method, timestamp, and the check_result/evidence rows in full, never summarized to pass/fail. The raw payload bytes are downloadable via the existing GET /documents/:evidenceId/download endpoint, which already serves any evidence row regardless of document_type. */
export async function getFullResult(
  ctx: AuthorizationContext,
  checkResultId: string,
): Promise<{ checkResult: Record<string, unknown>; evidence: Record<string, unknown> | null }> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(`SELECT * FROM check_result WHERE id = $1`, [checkResultId]);
    if (!rows[0]) throw new VerificationNotFoundError(checkResultId);
    const checkResult = rows[0];

    let evidence: Record<string, unknown> | null = null;
    if (checkResult.evidence_id) {
      const { rows: evidenceRows } = await client.query(
        `SELECT id, source, method, content_hash, captured_at FROM evidence WHERE id = $1`,
        [checkResult.evidence_id],
      );
      evidence = evidenceRows[0] ?? null;
    }
    return { checkResult, evidence };
  });
}

/** IDV-004: pure — no database, directly testable, same shape as computeOutstandingItems. */
export type Disparity = { field: string; brokerEntered: string | null; providerReturned: string | null };

export function computeDisparities(
  brokerEntered: { firstName: string; lastName: string; dateOfBirth: string | null },
  providerPayload: { firstName?: string; lastName?: string; dob?: string },
): Disparity[] {
  const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
  const disparities: Disparity[] = [];

  if (providerPayload.firstName !== undefined && norm(providerPayload.firstName) !== norm(brokerEntered.firstName)) {
    disparities.push({ field: 'firstName', brokerEntered: brokerEntered.firstName, providerReturned: providerPayload.firstName });
  }
  if (providerPayload.lastName !== undefined && norm(providerPayload.lastName) !== norm(brokerEntered.lastName)) {
    disparities.push({ field: 'lastName', brokerEntered: brokerEntered.lastName, providerReturned: providerPayload.lastName });
  }
  if (providerPayload.dob !== undefined && norm(providerPayload.dob) !== norm(brokerEntered.dateOfBirth)) {
    disparities.push({ field: 'dateOfBirth', brokerEntered: brokerEntered.dateOfBirth, providerReturned: providerPayload.dob });
  }
  return disparities;
}
