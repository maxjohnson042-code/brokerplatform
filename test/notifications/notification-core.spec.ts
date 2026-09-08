/**
 * Isolated proof of createNotification/markSent/preferences before wiring into any
 * other repository — direct-repository style, no HTTP.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker, createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';
import {
  createNotification,
  markSent,
  listMine,
  getPreferences,
  setPreference,
  MandatoryCategoryError,
} from '../../src/modules/notifications/notification.repository';

const systemCtx = { actorType: 'system' as const };

describe('notification.repository core (migration 0026)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('creates a notification atomically within the caller\'s own transaction and restores the original session vars', async () => {
    const suffix = Date.now().toString();
    const broker = await registerBroker({ email: `notif-core-${suffix}@example.com`, password: 'dev-password-123456', firstName: 'Notif', lastName: 'Core' });
    const brokerCtx = { actorType: 'broker' as const, actorId: broker.id };

    const result = await withAuthorizationContext(brokerCtx, async (client) => {
      const created = await createNotification(client, brokerCtx, {
        recipientType: 'broker',
        recipientId: broker.id,
        category: 'profile_submitted',
        subject: 'Your profile has been submitted',
        body: 'test body',
      });
      // The escalate-and-restore must leave the transaction usable under the ORIGINAL
      // ctx afterward — a broker can still read their own profile in the same tx.
      const { rows } = await client.query(`SELECT id FROM broker_profiles WHERE id = $1`, [broker.id]);
      return { created, stillBrokerScoped: rows.length === 1 };
    });

    expect(result.created.recipientEmail).toBe(`notif-core-${suffix}@example.com`);
    expect(result.created.shouldSend).toBe(true);
    expect(result.stillBrokerScoped).toBe(true);

    const mine = await listMine(brokerCtx, 'broker', broker.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].category).toBe('profile_submitted');
    expect(mine[0].suppressed).toBe(false);
    expect(mine[0].sent_at).toBeNull();

    await markSent(result.created.id);
    const afterSend = await listMine(brokerCtx, 'broker', broker.id);
    expect(afterSend[0].sent_at).not.toBeNull();
  });

  it('a disabled optional category suppresses shouldSend but still logs the notification', async () => {
    const suffix = Date.now().toString();
    const broker = await registerBroker({ email: `notif-core-pref-${suffix}@example.com`, password: 'dev-password-123456', firstName: 'Pref', lastName: 'Test' });
    const brokerCtx = { actorType: 'broker' as const, actorId: broker.id };

    await setPreference(brokerCtx, 'broker', broker.id, 'profile_submitted', false);
    const prefs = await getPreferences(brokerCtx, 'broker', broker.id);
    expect(prefs.find((p) => p.category === 'profile_submitted')?.enabled).toBe(false);

    const created = await withAuthorizationContext(brokerCtx, (client) =>
      createNotification(client, brokerCtx, {
        recipientType: 'broker',
        recipientId: broker.id,
        category: 'profile_submitted',
        subject: 'x',
        body: 'y',
      }),
    );
    expect(created.shouldSend).toBe(false);

    const mine = await listMine(brokerCtx, 'broker', broker.id);
    expect(mine[0].suppressed).toBe(true);
  });

  it('rejects disabling a mandatory category', async () => {
    const suffix = Date.now().toString();
    const broker = await registerBroker({ email: `notif-core-mandatory-${suffix}@example.com`, password: 'dev-password-123456', firstName: 'Mand', lastName: 'Test' });
    const brokerCtx = { actorType: 'broker' as const, actorId: broker.id };

    await expect(setPreference(brokerCtx, 'broker', broker.id, 'accreditation_declined', false)).rejects.toThrow(MandatoryCategoryError);
  });

  it('a client_user can create a notification for a broker they have no direct RLS visibility into (the escalation is real, not decorative)', async () => {
    const suffix = Date.now().toString();
    const broker = await registerBroker({ email: `notif-core-cross-${suffix}@example.com`, password: 'dev-password-123456', firstName: 'Cross', lastName: 'Actor' });
    const org = await createClientOrganisation(systemCtx, { type: 'lender', name: `Notif Core Lender ${suffix}` });
    const clientUser = await createClientUser(systemCtx, { clientOrganisationId: org.id, email: `notif-core-client-${suffix}@example.com`, password: 'dev-password-123456', role: 'reviewer' });
    const clientCtx = { actorType: 'client_user' as const, actorId: clientUser.id, clientOrganisationId: org.id };

    const created = await withAuthorizationContext(clientCtx, (client) =>
      createNotification(client, clientCtx, {
        recipientType: 'broker',
        recipientId: broker.id,
        category: 'accreditation_approved',
        subject: 'Approved',
        body: 'body',
      }),
    );
    expect(created.shouldSend).toBe(true);

    const brokerCtx = { actorType: 'broker' as const, actorId: broker.id };
    const mine = await listMine(brokerCtx, 'broker', broker.id);
    expect(mine).toHaveLength(1);
  });
});
