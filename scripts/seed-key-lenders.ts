/**
 * Seeds 10 real, recognisable Australian lender names into client_organisations so
 * REL-001's discoverable-organisations list — a broker requesting a new relationship
 * — shows more than just AMP Bank. Same minimal pair as ensureLenderOrg in
 * seed-amp-demo.ts (createClientOrganisation + verifyClientOrganisation): discovery
 * (migration 0029's broker-wide RLS branch) only requires verified_at IS NOT NULL and
 * status = 'active', neither of which needs a client_user/reviewer login — these are
 * name-only placeholders, not full demo lenders like AMP with a review queue.
 *
 * No brokers, no reviewer logins, nothing this touches the purge-demo-data.ts sweep
 * (which only ever deletes broker-scoped rows, never client_organisations) — these
 * rows are permanent, same treatment as AMP Bank itself.
 *
 * Logos: none set yet. Once real logo files exist, set one per org the same way
 * client-admin/organisation/logo does — upload via defaultImageStorage, then
 * updateClientOrganisationSetting(ctx, orgId, 'branding', { logoUrl }).
 *
 * Re-running is safe: skips any name that already exists.
 *
 * Run with: npx ts-node scripts/seed-key-lenders.ts
 */
import 'dotenv/config';
import { withAuthorizationContext } from '../src/db/authorization-context';
import { createClientOrganisation, verifyClientOrganisation } from '../src/modules/identity/identity.repository';

const LENDER_NAMES = [
  'Commonwealth Bank',
  'Westpac',
  'NAB',
  'ANZ',
  'Macquarie Bank',
  'ING',
  'Suncorp Bank',
  'Bankwest',
  'St.George Bank',
  'Pepper Money',
];

async function findClientOrganisationByName(name: string): Promise<string | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id FROM client_organisations WHERE name = $1`, [name]);
    return (rows[0]?.id as string | undefined) ?? null;
  });
}

async function main() {
  for (const name of LENDER_NAMES) {
    const existing = await findClientOrganisationByName(name);
    if (existing) {
      console.log(`Reusing existing lender organisation "${name}" (${existing}).`);
      continue;
    }
    const org = await createClientOrganisation({ actorType: 'system' }, { type: 'lender', name });
    await verifyClientOrganisation({ actorType: 'system' }, org.id);
    console.log(`Created and verified "${name}" (${org.id}).`);
  }
  console.log('\nDone. These now appear in a broker\'s discoverable-organisations list (REL-001) with no logo yet.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
