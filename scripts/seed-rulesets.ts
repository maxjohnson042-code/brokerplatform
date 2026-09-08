/**
 * Creates and publishes the two seeded rulesets (Westpac-modelled + NAB-modelled,
 * Section 9.3) against a given client organisation, using the real repository
 * functions (createDraft/publish) rather than raw SQL — so this also exercises the
 * versioning path end to end. Same manual-run precedent as
 * scripts/seed-platform-admin.ts and scripts/demo-tenancy.ts.
 *
 * Run with: npm run seed:rulesets -- <clientOrganisationId>
 */
import { randomUUID } from 'crypto';
import { pool } from '../src/db/pool';
import { createDraft, publish } from '../src/modules/rulesets/rulesets.repository';
import { WESTPAC_SEED_RULESETS } from '../src/modules/rulesets/seed-data/westpac';
import { NAB_SEED_RULESETS } from '../src/modules/rulesets/seed-data/nab';

async function main() {
  const [clientOrganisationId] = process.argv.slice(2);
  if (!clientOrganisationId) {
    console.error('Usage: npm run seed:rulesets -- <clientOrganisationId>');
    process.exit(1);
  }

  const ctx = { actorType: 'platform_admin' as const, actorId: randomUUID() };

  for (const seed of [...WESTPAC_SEED_RULESETS, ...NAB_SEED_RULESETS]) {
    const { id } = await createDraft(ctx, { clientOrganisationId, ...seed.key, label: seed.label, definition: seed.definition });
    await publish(ctx, id);
    console.log(`Published: ${seed.label} (${id})`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
