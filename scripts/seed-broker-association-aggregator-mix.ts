/**
 * Retrofits the 50 AMP demo brokers (scripts/seed-amp-demo.ts) with a realistic
 * association (MFAA/FBAA) and aggregator mix, so the lender dashboard's "Association
 * mix" and "Aggregator mix" cards (migration 0030) show real variety instead of
 * "51 MFAA" / "51 Direct — no aggregator".
 *
 * Requires scripts/seed-key-aggregators.ts to have already run (looks up the 10
 * aggregator orgs by name, does not create them).
 *
 * Association memberships: every demo broker already has exactly one MFAA row from
 * the original seed. This deletes and replaces it via a direct system-context write —
 * NOT via brokers.repository.ts's createAssociationMembership, which gates on
 * assertEditable(draft/attention_required); these brokers are all long since
 * 'submitted', so that repository function would reject every one of them. Direct SQL
 * is fine for a data-seeding script the same way purge-demo-data.ts already does its
 * own direct writes; association_memberships DOES have a DELETE grant to the app role
 * (migration 0016), unlike the append-only tables.
 *
 * Rotation (by broker index, deterministic so re-runs are idempotent):
 *   i % 3 == 0 -> FBAA only
 *   i % 3 == 1 -> MFAA + FBAA
 *   i % 3 == 2 -> MFAA only (left as seeded, no change)
 *   i % 2 == 0 -> gets an aggregator_membership relationship (round-robin across the
 *                 10 aggregators); i % 2 == 1 stays "Direct — no aggregator".
 * Aggregator relationships use requestRelationship (relationships.repository.ts) as
 * the broker's own ctx — no editability gate on that path, matches how the broker
 * would really request a link.
 *
 * Run with: npx ts-node scripts/seed-broker-association-aggregator-mix.ts
 */
import 'dotenv/config';
import { withAuthorizationContext } from '../src/db/authorization-context';
import { requestRelationship } from '../src/modules/relationships/relationships.repository';
import { AGGREGATOR_NAMES } from './seed-key-aggregators';

const DEMO_EMAIL_PATTERN = '%@demo.brok3r.test';

async function findAggregatorIds(): Promise<string[]> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id, name FROM client_organisations WHERE name = ANY($1)`, [AGGREGATOR_NAMES]);
    const byName = new Map(rows.map((r) => [r.name as string, r.id as string]));
    const missing = AGGREGATOR_NAMES.filter((n) => !byName.has(n));
    if (missing.length > 0) {
      throw new Error(`Missing aggregator orgs — run seed-key-aggregators.ts first. Missing: ${missing.join(', ')}`);
    }
    return AGGREGATOR_NAMES.map((n) => byName.get(n)!);
  });
}

async function findDemoBrokers(): Promise<Array<{ id: string; email: string }>> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id, email FROM broker_profiles WHERE email LIKE $1 ORDER BY email`, [DEMO_EMAIL_PATTERN]);
    return rows;
  });
}

async function setAssociations(brokerProfileId: string, names: string[]): Promise<void> {
  await withAuthorizationContext({ actorType: 'system' }, async (client) => {
    await client.query(`DELETE FROM association_memberships WHERE broker_profile_id = $1`, [brokerProfileId]);
    for (const name of names) {
      const membershipNumber = `${name}-${Math.floor(100000 + Math.random() * 900000)}`;
      await client.query(
        `INSERT INTO association_memberships (broker_profile_id, association_name, membership_number, confirmed_by_association)
         VALUES ($1, $2, $3, true)`,
        [brokerProfileId, name, membershipNumber],
      );
    }
  });
}

async function hasAggregatorRelationship(brokerProfileId: string, aggregatorOrgId: string): Promise<boolean> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM relationships WHERE broker_profile_id = $1 AND client_organisation_id = $2 AND type = 'aggregator_membership'`,
      [brokerProfileId, aggregatorOrgId],
    );
    return rows.length > 0;
  });
}

async function main() {
  const aggregatorIds = await findAggregatorIds();
  const brokers = await findDemoBrokers();
  if (brokers.length === 0) {
    console.log('No demo brokers found (nothing matching @demo.brok3r.test) — run seed-amp-demo.ts first.');
    return;
  }
  console.log(`Found ${brokers.length} demo broker(s).`);

  // A separate counter for which of the 10 aggregators to assign, incremented only
  // for brokers that get one — indexing by `i` directly (which is only ever even
  // here) would only ever land on 5 of the 10 aggregators, never the odd-indexed ones.
  let aggregatorAssignmentIndex = 0;

  for (let i = 0; i < brokers.length; i++) {
    const broker = brokers[i];
    const mod3 = i % 3;
    const names = mod3 === 0 ? ['FBAA'] : mod3 === 1 ? ['MFAA', 'FBAA'] : ['MFAA'];
    await setAssociations(broker.id, names);

    if (i % 2 === 0) {
      const aggregatorOrgId = aggregatorIds[aggregatorAssignmentIndex % aggregatorIds.length];
      aggregatorAssignmentIndex += 1;
      const already = await hasAggregatorRelationship(broker.id, aggregatorOrgId);
      if (!already) {
        await requestRelationship({ actorType: 'broker', actorId: broker.id }, {
          brokerProfileId: broker.id,
          clientOrganisationId: aggregatorOrgId,
          type: 'aggregator_membership',
          consentVersion: 'v1',
        });
      }
    }
  }

  console.log(`Done. Associations set to a MFAA/FBAA/both mix; every other broker linked to one of the ${aggregatorIds.length} aggregators.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
