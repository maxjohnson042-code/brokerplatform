import { withAuthorizationContext, AuthorizationContext } from '../../db/authorization-context';

/**
 * PRF-001 / CLI-002: reads broker_profiles through the SAME AuthorizationContext
 * mechanism a client_user or the broker themself would use — this function applies no
 * filtering of its own. If the row isn't visible, RLS (migration 0007) returns zero
 * rows, and that's the correct answer whether the caller is a lender with no
 * relationship or a broker asking for someone else's profile. This is deliberate:
 * scripts/demo-tenancy.ts calls this exact function as three different actors to
 * prove the boundary holds, and Epic 3's actual HTTP layer should do the same.
 */
export async function getBrokerProfile(
  ctx: AuthorizationContext,
  brokerProfileId: string,
): Promise<Record<string, unknown> | null> {
  return withAuthorizationContext(ctx, async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, first_name, last_name, status, created_at
       FROM broker_profiles WHERE id = $1`,
      [brokerProfileId],
    );
    return rows[0] ?? null;
  });
}
