/**
 * RLS proof for notifications: a broker sees their own, not another broker's; a
 * client_user sees their own, not another org's; a direct attempt to INSERT/UPDATE a
 * notifications row under a non-system ctx is denied — proving createNotification's
 * transaction-scoped escalation is genuinely necessary, not decorative.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import { createNotification, listMine } from '../../src/modules/notifications/notification.repository';

const systemCtx = { actorType: 'system' as const };

async function seedBroker(suffix: string) {
  const broker = await registerBroker({ email: `notif-rls-${suffix}@example.com`, password: 'dev-password-123456', firstName: 'Notif', lastName: 'RLS' });
  return { broker, ctx: { actorType: 'broker' as const, actorId: broker.id } };
}

async function seedClientUser(suffix: string) {
  const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Notif RLS Lender ${suffix}` });
  const user = await createClientUser(systemCtx, { clientOrganisationId: org.id, email: `notif-rls-client-${suffix}@example.com`, password: 'dev-password-123456', role: 'reviewer' });
  return { org, user, ctx: { actorType: 'client_user' as const, actorId: user.id, clientOrganisationId: org.id } };
}

describe('notifications RLS (migration 0026)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a broker sees their own notifications, not another broker\'s', async () => {
    const suffix = Date.now().toString();
    const brokerA = await seedBroker(`${suffix}-a`);
    const brokerB = await seedBroker(`${suffix}-b`);

    await withAuthorizationContext(brokerA.ctx, (client) =>
      createNotification(client, brokerA.ctx, { recipientType: 'broker', recipientId: brokerA.broker.id, category: 'profile_submitted', subject: 'x', body: 'y' }),
    );

    const ownList = await listMine(brokerA.ctx, 'broker', brokerA.broker.id);
    expect(ownList).toHaveLength(1);

    const otherList = await listMine(brokerB.ctx, 'broker', brokerA.broker.id);
    expect(otherList).toHaveLength(0);
  });

  it('a client_user sees their own org\'s notifications, not another org\'s', async () => {
    const suffix = Date.now().toString();
    const linked = await seedClientUser(`${suffix}-linked`);
    const stranger = await seedClientUser(`${suffix}-stranger`);

    await withAuthorizationContext(systemCtx, (client) =>
      createNotification(client, systemCtx, { recipientType: 'client_user', recipientId: linked.user.id, category: 'accreditation_queue_entry', subject: 'x', body: 'y' }),
    );

    const ownList = await listMine(linked.ctx, 'client_user', linked.user.id);
    expect(ownList).toHaveLength(1);

    const strangerList = await listMine(stranger.ctx, 'client_user', linked.user.id);
    expect(strangerList).toHaveLength(0);
  });

  it('a direct INSERT under a non-system ctx is denied by RLS (the escalation is genuinely necessary)', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);

    await expect(
      withAuthorizationContext(broker.ctx, (client) =>
        client.query(
          `INSERT INTO notifications (recipient_type, recipient_id, category, subject, body) VALUES ('broker', $1, 'profile_submitted', 'x', 'y')`,
          [broker.broker.id],
        ),
      ),
    ).rejects.toThrow();
  });

  it('a direct UPDATE (marking sent) under a non-system ctx is denied by RLS', async () => {
    const suffix = Date.now().toString();
    const broker = await seedBroker(suffix);
    const { id } = await withAuthorizationContext(broker.ctx, (client) =>
      createNotification(client, broker.ctx, { recipientType: 'broker', recipientId: broker.broker.id, category: 'profile_submitted', subject: 'x', body: 'y' }),
    );

    // The row exists (created via the system-escalated path inside createNotification)
    // but the broker's own ctx cannot mark it sent directly — only markSent's
    // standalone system-ctx call can.
    const { rowCount } = await withAuthorizationContext(broker.ctx, (client) => client.query(`UPDATE notifications SET sent_at = now() WHERE id = $1`, [id]));
    expect(rowCount).toBe(0);
  });
});
