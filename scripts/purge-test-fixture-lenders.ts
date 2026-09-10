/**
 * Deletes lender organisations that are pure test-suite fixture noise cluttering
 * REL-001's discoverable-organisations list (found while verifying the "key lenders"
 * work — the list was mixed real names in with Jest-run leftovers).
 *
 * Two categories, both confirmed before writing this script (via one-off inspection
 * queries, not kept):
 *   - 'Type Filter Lender <ts>' / 'Verified Lender <ts>' — created directly inside
 *     test/relationships/organisation-discovery-rls.spec.ts on every run, a new
 *     timestamp suffix each time. Genuinely ephemeral by that test's own design.
 *   - 'Demo Capital Lending', 'Notif Walkthrough Lender', 'Ruleset Walkthrough
 *     Lender', 'Stranger Lender', 'Test Lender Co' — a repo-wide grep found these
 *     five names nowhere in any current test or script, meaning whatever created
 *     them no longer exists in the codebase; nothing depends on them existing.
 *
 * Deliberately NOT touched (never matched by NAME_PATTERNS below): 'AMP Bank',
 * 'Demo Lender Bank' (scripts/seed-demo-data.ts's own persistent org, see that
 * file's header comment), and the 10 real lenders from seed-key-lenders.ts.
 *
 * Connects via DATABASE_URL (the migration-owner role), not the RLS-bound app role —
 * same reasoning as purge-demo-data.ts and db/migrate.ts: migration 0007 deliberately
 * grants the app role no DELETE at all on evidence/check_result/check_exceptions/
 * audit_log/metering_event/accreditation_decisions/training_confirmations (Sections
 * 20.4/20.5's append-only requirement) — "a deliberate, logged, superuser operation,
 * not something the running application can ever do." This script IS that operation.
 * Deletes in strict child-to-parent order since none of these FKs cascade.
 *
 * Run with: npx ts-node scripts/purge-test-fixture-lenders.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const NAME_PATTERNS = [
  'Type Filter Lender%',
  'Verified Lender%',
  'Demo Capital Lending',
  'Notif Walkthrough Lender',
  'Ruleset Walkthrough Lender',
  'Stranger Lender',
  'Test Lender Co',
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set — copy .env.example to .env');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    const { rows: orgs } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM client_organisations WHERE name LIKE ANY($1) ORDER BY name`,
      [NAME_PATTERNS],
    );
    if (orgs.length === 0) {
      console.log('Nothing matched — already clean.');
      await client.query('ROLLBACK');
      return;
    }
    console.log(`Purging ${orgs.length} test-fixture organisation(s):`);
    for (const o of orgs) console.log(`  ${o.name} (${o.id})`);
    const orgIds = orgs.map((o) => o.id);

    const { rows: accRows } = await client.query<{ id: string }>(
      `SELECT id FROM accreditations WHERE lender_client_organisation_id = ANY($1) OR licence_holder_client_organisation_id = ANY($1)`,
      [orgIds],
    );
    const accIds = accRows.map((r) => r.id);
    if (accIds.length > 0) {
      await client.query(`DELETE FROM accreditation_decisions WHERE accreditation_id = ANY($1)`, [accIds]);
      await client.query(`DELETE FROM training_confirmations WHERE accreditation_id = ANY($1)`, [accIds]);
      await client.query(`DELETE FROM accreditations WHERE id = ANY($1)`, [accIds]);
    }

    await client.query(`DELETE FROM check_exceptions WHERE client_organisation_id = ANY($1)`, [orgIds]);
    await client.query(`DELETE FROM audit_log WHERE client_organisation_id = ANY($1)`, [orgIds]);
    await client.query(`DELETE FROM metering_event WHERE client_organisation_id = ANY($1)`, [orgIds]);
    await client.query(`DELETE FROM ruleset_versions WHERE client_organisation_id = ANY($1)`, [orgIds]);
    await client.query(`DELETE FROM relationships WHERE client_organisation_id = ANY($1)`, [orgIds]);

    const { rows: cuRows } = await client.query<{ id: string }>(`SELECT id FROM client_users WHERE client_organisation_id = ANY($1)`, [orgIds]);
    const clientUserIds = cuRows.map((r) => r.id);
    if (clientUserIds.length > 0) {
      await client.query(`DELETE FROM refresh_tokens WHERE actor_type = 'client_user' AND actor_id = ANY($1)`, [clientUserIds]);
      await client.query(`DELETE FROM password_reset_tokens WHERE actor_type = 'client_user' AND actor_id = ANY($1)`, [clientUserIds]);
      await client.query(`DELETE FROM notification_preferences WHERE actor_type = 'client_user' AND actor_id = ANY($1)`, [clientUserIds]);
      await client.query(`DELETE FROM notifications WHERE recipient_type = 'client_user' AND recipient_id = ANY($1)`, [clientUserIds]);
      await client.query(`DELETE FROM client_user_mfa_secrets WHERE client_user_id = ANY($1)`, [clientUserIds]);
      // check_exceptions.decided_by_client_user_id: not scoped to client_organisation_id,
      // so a stray reference from an exception logged under a different org is possible
      // in principle — nulled out defensively rather than assumed absent.
      await client.query(`UPDATE check_exceptions SET decided_by_client_user_id = NULL WHERE decided_by_client_user_id = ANY($1)`, [clientUserIds]);
    }
    await client.query(`DELETE FROM client_users WHERE client_organisation_id = ANY($1)`, [orgIds]);

    const { rowCount } = await client.query(`DELETE FROM client_organisations WHERE id = ANY($1)`, [orgIds]);
    await client.query('COMMIT');
    console.log(`\nDeleted ${rowCount} organisation(s) and all their dependent rows.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
