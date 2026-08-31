/**
 * Proves migration 0013's client_users/client_organisations RLS policies — the
 * database-layer backstop AUTH-008 relies on — the same way scripts/demo-tenancy.ts
 * proves broker_profiles' RLS in Epic 1: call the repository layer to set up real
 * data, then issue raw queries under a specific AuthorizationContext and check what
 * comes back, rather than mocking anything.
 *
 * This intentionally bypasses identity.repository.ts's own listClientUsers (which
 * already filters explicitly by clientOrganisationId — Section 20.2's "layer one") to
 * exercise RLS ("layer two") directly: if layer one had a bug and forgot its WHERE
 * clause, layer two must still hold.
 */
import { pool } from '../../src/db/pool';
import { withAuthorizationContext } from '../../src/db/authorization-context';
import { createClientOrganisation, createClientUser } from '../../src/modules/identity/identity.repository';

const systemCtx = { actorType: 'system' as const };

describe('client_users / client_organisations row-level security (AUTH-008, migration 0013)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('a client_admin cannot read another organisation\'s users, even with a raw query', async () => {
    const suffix = Date.now();
    const orgA = await createClientOrganisation(systemCtx, { type: 'lender', name: `RLS Org A ${suffix}` });
    const orgB = await createClientOrganisation(systemCtx, { type: 'lender', name: `RLS Org B ${suffix}` });
    const adminA = await createClientUser(systemCtx, {
      clientOrganisationId: orgA.id,
      email: `admin-a-${suffix}@example.com`,
      password: 'dev-password-123456',
      role: 'client_admin',
    });
    await createClientUser(systemCtx, {
      clientOrganisationId: orgB.id,
      email: `admin-b-${suffix}@example.com`,
      password: 'dev-password-123456',
      role: 'client_admin',
    });

    const ctxA = { actorType: 'client_user' as const, actorId: adminA.id, clientOrganisationId: orgA.id };

    const ownOrgRows = await withAuthorizationContext(ctxA, (client) =>
      client.query('SELECT id FROM client_users WHERE client_organisation_id = $1', [orgA.id]),
    );
    expect(ownOrgRows.rows).toHaveLength(1);

    const otherOrgRows = await withAuthorizationContext(ctxA, (client) =>
      client.query('SELECT id FROM client_users WHERE client_organisation_id = $1', [orgB.id]),
    );
    expect(otherOrgRows.rows).toHaveLength(0);

    const otherOrgUnfiltered = await withAuthorizationContext(ctxA, (client) =>
      client.query('SELECT id FROM client_users'),
    );
    expect(otherOrgUnfiltered.rows.map((r) => r.id)).toEqual([adminA.id]);

    const otherOrgRow = await withAuthorizationContext(ctxA, (client) =>
      client.query('SELECT id, name FROM client_organisations WHERE id = $1', [orgB.id]),
    );
    expect(otherOrgRow.rows).toHaveLength(0);
  });

  it('a client_admin cannot insert a user into another organisation', async () => {
    const suffix = Date.now();
    const orgA = await createClientOrganisation(systemCtx, { type: 'lender', name: `RLS Insert Org A ${suffix}` });
    const orgB = await createClientOrganisation(systemCtx, { type: 'lender', name: `RLS Insert Org B ${suffix}` });
    const adminA = await createClientUser(systemCtx, {
      clientOrganisationId: orgA.id,
      email: `insert-admin-a-${suffix}@example.com`,
      password: 'dev-password-123456',
      role: 'client_admin',
    });

    const ctxA = { actorType: 'client_user' as const, actorId: adminA.id, clientOrganisationId: orgA.id };

    await expect(
      withAuthorizationContext(ctxA, (client) =>
        client.query(
          `INSERT INTO client_users (client_organisation_id, email, role, password_hash)
           VALUES ($1, $2, 'reviewer', 'x')`,
          [orgB.id, `sneaky-${suffix}@example.com`],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a client_admin CAN provision a user into their own organisation via a raw insert', async () => {
    const suffix = Date.now();
    const orgA = await createClientOrganisation(systemCtx, { type: 'lender', name: `RLS Own Insert Org ${suffix}` });
    const adminA = await createClientUser(systemCtx, {
      clientOrganisationId: orgA.id,
      email: `own-admin-${suffix}@example.com`,
      password: 'dev-password-123456',
      role: 'client_admin',
    });
    const ctxA = { actorType: 'client_user' as const, actorId: adminA.id, clientOrganisationId: orgA.id };

    const { rows } = await withAuthorizationContext(ctxA, (client) =>
      client.query(
        `INSERT INTO client_users (client_organisation_id, email, role, password_hash)
         VALUES ($1, $2, 'reviewer', 'x') RETURNING id`,
        [orgA.id, `legit-${suffix}@example.com`],
      ),
    );
    expect(rows).toHaveLength(1);
  });
});
