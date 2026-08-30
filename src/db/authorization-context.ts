import { PoolClient } from 'pg';
import { pool } from './pool';

/**
 * Section 20.2, layer one: "every query touching broker data goes through a single
 * repository layer that requires an AuthorisationContext (actor, organisation,
 * relationship set). There is no code path that reads broker data without one."
 *
 * This is that single repository layer's entry point. Every module's repository
 * calls withAuthorizationContext(ctx, ...) instead of touching `pool` itself — see
 * test/architecture.spec.ts, which fails the build if any module imports pg or
 * ../db/pool directly.
 */
export type AuthorizationContext =
  | { actorType: 'broker'; actorId: string }
  | { actorType: 'client_user'; actorId: string; clientOrganisationId: string }
  | { actorType: 'platform_admin'; actorId: string }
  | { actorType: 'system' };

/**
 * Runs `work` inside a transaction with the actor's identity set as Postgres session
 * variables via set_config(..., is_local => true) — the parametrised equivalent of
 * `SET LOCAL app.actor_type = '...'`, chosen specifically so actor/organisation IDs
 * never get string-interpolated into SQL. The row-level security policies in
 * migration 0007 read these same three variables with current_setting(...).
 *
 * Because this is SET LOCAL (scoped to the transaction) rather than SET, a
 * connection-pool client returning to the pool at COMMIT can never leak one request's
 * actor identity into the next request that happens to reuse the same connection —
 * that failure mode is exactly what the master document (Section 20.2) is guarding
 * against with "belt and braces".
 */
export async function withAuthorizationContext<T>(
  ctx: AuthorizationContext,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`SELECT set_config('app.actor_type', $1, true)`, [ctx.actorType]);
    await client.query(`SELECT set_config('app.actor_id', $1, true)`, [
      'actorId' in ctx ? ctx.actorId : '',
    ]);
    await client.query(`SELECT set_config('app.client_organisation_id', $1, true)`, [
      ctx.actorType === 'client_user' ? ctx.clientOrganisationId : '',
    ]);

    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
