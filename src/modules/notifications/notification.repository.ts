import { PoolClient } from 'pg';
import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';
import { NotificationCategory, MANDATORY_NOTIFICATION_CATEGORIES } from './notification-templates';

export type RecipientType = 'broker' | 'client_user';

export type Notification = {
  id: string;
  recipient_type: RecipientType;
  recipient_id: string;
  category: string;
  channel: string;
  subject: string;
  body: string;
  related_record_type: string | null;
  related_record_id: string | null;
  suppressed: boolean;
  sent_at: string | null;
  created_at: string;
};

export type NotificationPreference = {
  id: string;
  actor_type: RecipientType;
  actor_id: string;
  category: string;
  enabled: boolean;
  updated_at: string;
};

export class MandatoryCategoryError extends Error {
  constructor(category: string) {
    super(`'${category}' is a mandatory notification category and cannot be disabled`);
    this.name = 'MandatoryCategoryError';
  }
}
export class RecipientNotFoundError extends Error {
  constructor(recipientType: RecipientType, recipientId: string) {
    super(`no ${recipientType} found with id: ${recipientId}`);
    this.name = 'RecipientNotFoundError';
  }
}

/**
 * Creation is atomic with the domain write it's about (same client, called from
 * inside the caller's own transaction — same pattern as recordAuditEvent) — this is
 * what actually satisfies NOT-007, even if the later email send fails.
 *
 * Almost always creates a notification for a DIFFERENT actor than the one whose
 * transaction is running (a client_user approving an accreditation creates a
 * notification for the broker), and notifications_insert's RLS policy is
 * deliberately system-only — so this escalates via a transaction-scoped
 * SET LOCAL app.actor_type='system', then restores the caller's original value
 * immediately after, same mechanism as Epic 10's flagPartyChanged.
 */
export async function createNotification(
  client: PoolClient,
  ctx: AuthorizationContext,
  params: {
    recipientType: RecipientType;
    recipientId: string;
    category: NotificationCategory;
    subject: string;
    body: string;
    relatedRecordType?: string;
    relatedRecordId?: string;
  },
): Promise<{ id: string; recipientEmail: string; shouldSend: boolean }> {
  await client.query(`SELECT set_config('app.actor_type', 'system', true)`);
  try {
    const recipientTable = params.recipientType === 'broker' ? 'broker_profiles' : 'client_users';
    const { rows: recipientRows } = await client.query(`SELECT email FROM ${recipientTable} WHERE id = $1`, [params.recipientId]);
    if (!recipientRows[0]) throw new RecipientNotFoundError(params.recipientType, params.recipientId);
    const recipientEmail = recipientRows[0].email as string;

    const { rows: prefRows } = await client.query(
      `SELECT enabled FROM notification_preferences WHERE actor_type = $1 AND actor_id = $2 AND category = $3`,
      [params.recipientType, params.recipientId, params.category],
    );
    const enabled = prefRows[0] ? (prefRows[0].enabled as boolean) : true;

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO notifications
         (recipient_type, recipient_id, category, subject, body, related_record_type, related_record_id, suppressed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        params.recipientType,
        params.recipientId,
        params.category,
        params.subject,
        params.body,
        params.relatedRecordType ?? null,
        params.relatedRecordId ?? null,
        !enabled,
      ],
    );

    return { id: rows[0].id, recipientEmail, shouldSend: enabled };
  } finally {
    await client.query(`SELECT set_config('app.actor_type', $1, true)`, [ctx.actorType]);
  }
}

/** Standalone, post-commit — called after EmailSender.send() succeeds, not nested inside another transaction. */
export async function markSent(notificationId: string): Promise<void> {
  await withAuthorizationContext({ actorType: 'system' }, (client) =>
    client.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [notificationId]),
  );
}

export async function listMine(ctx: AuthorizationContext, recipientType: RecipientType, recipientId: string): Promise<Notification[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<Notification>(
      `SELECT * FROM notifications WHERE recipient_type = $1 AND recipient_id = $2 ORDER BY created_at DESC`,
      [recipientType, recipientId],
    );
    return rows;
  });
}

export async function getPreferences(ctx: AuthorizationContext, actorType: RecipientType, actorId: string): Promise<NotificationPreference[]> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query<NotificationPreference>(
      `SELECT * FROM notification_preferences WHERE actor_type = $1 AND actor_id = $2`,
      [actorType, actorId],
    );
    return rows;
  });
}

export async function setPreference(
  ctx: AuthorizationContext,
  actorType: RecipientType,
  actorId: string,
  category: NotificationCategory,
  enabled: boolean,
): Promise<void> {
  if (!enabled && MANDATORY_NOTIFICATION_CATEGORIES.has(category)) throw new MandatoryCategoryError(category);

  return withAuthorizationContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO notification_preferences (actor_type, actor_id, category, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (actor_type, actor_id, category) DO UPDATE SET enabled = $4, updated_at = now()`,
      [actorType, actorId, category, enabled],
    );
  });
}
