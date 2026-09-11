/**
 * Seeds 10 real, recognisable Australian aggregator names into client_organisations —
 * same treatment as seed-key-lenders.ts, just type: 'aggregator'. These make the
 * broker's discoverable-organisations list show real aggregators to link to, and give
 * the lender dashboard's "Aggregator mix" card (migration 0030's broker-mediated
 * cross-org visibility) real names to show once brokers are linked to them.
 *
 * No brokers, no reviewer logins — name-only placeholders, not full demo aggregators
 * with their own review queue. Permanent, same as the 10 key lenders: not touched by
 * purge-demo-data.ts (which only ever deletes broker-scoped rows).
 *
 * Logos: none set yet — see upload-lender-logos.ts for the exact pattern once real
 * logo files exist for these.
 *
 * Re-running is safe: skips any name that already exists.
 *
 * Run with: npx ts-node scripts/seed-key-aggregators.ts
 */
import 'dotenv/config';
import { withAuthorizationContext } from '../src/db/authorization-context';
import { createClientOrganisation, verifyClientOrganisation } from '../src/modules/identity/identity.repository';

export const AGGREGATOR_NAMES = [
  'AFG (Australian Finance Group)',
  'Connective',
  'Loan Market',
  'Finsure',
  'PLAN Australia',
  'Choice Aggregation Services',
  'Vow Financial',
  'Mortgage Choice',
  'Astute Financial',
  'Specialist Finance Group',
];

async function findClientOrganisationByName(name: string): Promise<string | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id FROM client_organisations WHERE name = $1`, [name]);
    return (rows[0]?.id as string | undefined) ?? null;
  });
}

async function main() {
  for (const name of AGGREGATOR_NAMES) {
    const existing = await findClientOrganisationByName(name);
    if (existing) {
      console.log(`Reusing existing aggregator organisation "${name}" (${existing}).`);
      continue;
    }
    const org = await createClientOrganisation({ actorType: 'system' }, { type: 'aggregator', name });
    await verifyClientOrganisation({ actorType: 'system' }, org.id);
    console.log(`Created and verified "${name}" (${org.id}).`);
  }
  console.log('\nDone. These now appear in a broker\'s discoverable-organisations list (REL-001) with no logo yet.');
}

// Guarded so other scripts can import AGGREGATOR_NAMES (e.g.
// seed-broker-association-aggregator-mix.ts) without re-running this seed and
// killing their own process via the process.exit(0) below.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
