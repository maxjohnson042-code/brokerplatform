/**
 * Proves migration 0015's new UPDATE/DELETE policies on association_memberships —
 * added specifically because 0007 shipped this table with only SELECT/INSERT,
 * silently blocking every UPDATE/DELETE for every actor. Same "layer two must hold
 * even if layer one has a bug" reasoning as
 * test/identity/client-user-provisioning-rls.spec.ts: issue raw queries under a
 * specific AuthorizationContext directly, bypassing brokers.repository.ts's own
 * ownership checks, so a bug in layer one wouldn't be masked by this test.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { registerBroker } from '../../src/modules/identity/identity.repository';
import { createAssociationMembership } from '../../src/modules/brokers/brokers.repository';

describe('association_memberships row-level security (migration 0015)', () => {
  afterAll(async () => {
    await pool.end();
  });

  async function seedBrokerWithMembership(suffix: string) {
    const broker = await registerBroker({
      email: `assoc-rls-${suffix}@example.com`,
      password: 'dev-password-123456',
      firstName: 'Test',
      lastName: 'Broker',
    });
    const brokerCtx = { actorType: 'broker' as const, actorId: broker.id };
    const membership = await createAssociationMembership(brokerCtx, broker.id, {
      associationName: 'MFAA',
      membershipNumber: `MFAA-${suffix}`,
    });
    return { broker, brokerCtx, membership };
  }

  it('broker A cannot update broker B\'s association membership via a raw query', async () => {
    const suffix = Date.now().toString();
    const a = await seedBrokerWithMembership(`${suffix}-a`);
    const b = await seedBrokerWithMembership(`${suffix}-b`);

    const { rowCount } = await withAuthorizationContext(a.brokerCtx, (client) =>
      client.query(`UPDATE association_memberships SET membership_number = 'HACKED' WHERE id = $1`, [
        b.membership.id,
      ]),
    );
    expect(rowCount).toBe(0);

    const stillOriginal = await withAuthorizationContext({ actorType: 'system' }, (client) =>
      client.query(`SELECT membership_number FROM association_memberships WHERE id = $1`, [b.membership.id]),
    );
    expect(stillOriginal.rows[0].membership_number).toBe(`MFAA-${suffix}-b`);
  });

  it('broker A cannot delete broker B\'s association membership via a raw query', async () => {
    const suffix = Date.now().toString();
    const a = await seedBrokerWithMembership(`${suffix}-a`);
    const b = await seedBrokerWithMembership(`${suffix}-b`);

    const { rowCount } = await withAuthorizationContext(a.brokerCtx, (client) =>
      client.query(`DELETE FROM association_memberships WHERE id = $1`, [b.membership.id]),
    );
    expect(rowCount).toBe(0);

    const stillThere = await withAuthorizationContext({ actorType: 'system' }, (client) =>
      client.query(`SELECT id FROM association_memberships WHERE id = $1`, [b.membership.id]),
    );
    expect(stillThere.rows).toHaveLength(1);
  });

  it('a broker CAN update and delete their own association membership via a raw query', async () => {
    const suffix = Date.now().toString();
    const a = await seedBrokerWithMembership(`${suffix}-own`);

    const updated = await withAuthorizationContext(a.brokerCtx, (client) =>
      client.query(`UPDATE association_memberships SET membership_number = 'UPDATED' WHERE id = $1`, [
        a.membership.id,
      ]),
    );
    expect(updated.rowCount).toBe(1);

    const deleted = await withAuthorizationContext(a.brokerCtx, (client) =>
      client.query(`DELETE FROM association_memberships WHERE id = $1`, [a.membership.id]),
    );
    expect(deleted.rowCount).toBe(1);
  });
});
