/**
 * Deletes everything scripts/seed-demo-data.ts created — every broker whose email
 * ends in @demo.brok3r.test, plus every row anywhere in the schema that hangs off
 * one of those brokers (business, affiliations, relationships, accreditations,
 * decisions, training confirmations, notifications, tokens, audit trail).
 *
 * The email domain IS the demo marker — there's no is_demo column anywhere, so this
 * is the ONLY thing that decides what counts as "demo data". Real brokers will never
 * have an @demo.brok3r.test address, so this can't reach outside what the seed
 * script itself created.
 *
 * Deliberately does NOT touch the lender organisation ("Demo Lender Bank") or its
 * reviewer login (reviewer@demo.brok3r.test in client_users) — those are the fixed
 * "who's using the product" identity the seed script finds-or-creates, not
 * disposable batch data. Re-running seed-demo-data.ts after this reuses them.
 *
 * Connects via DATABASE_URL (the migration-owner role), not the RLS-bound app role —
 * same reasoning as db/migrate.ts: this is a database-administration operation, not
 * something any real actor context in the product can do (there is deliberately no
 * "delete a broker" feature). Deletes in strict child-to-parent order since none of
 * these FKs cascade.
 *
 * Also purges evidence/check-result rows for demo brokers even though Section 20.4
 * documents evidence as "write-once, never deleted ahead of retained_until" — that
 * rule protects real compliance records; this script only ever touches synthetic
 * ones matched by the same email-domain marker.
 *
 * Run with: npm run purge:demo-data
 */
import 'dotenv/config';
import { Client } from 'pg';

const DEMO_EMAIL_PATTERN = '%@demo.brok3r.test';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set — copy .env.example to .env');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    const { rows: brokerRows } = await client.query<{ id: string }>(
      `SELECT id FROM broker_profiles WHERE email LIKE $1`,
      [DEMO_EMAIL_PATTERN],
    );
    const brokerIds = brokerRows.map((r) => r.id);

    if (brokerIds.length === 0) {
      console.log('No demo brokers found (nothing matching @demo.brok3r.test) — nothing to purge.');
      await client.query('ROLLBACK');
      return;
    }

    const { rows: businessRows } = await client.query<{ id: string }>(
      `SELECT DISTINCT broker_business_id AS id FROM business_affiliations WHERE broker_profile_id = ANY($1::uuid[])`,
      [brokerIds],
    );
    const businessIds = businessRows.map((r) => r.id);

    const { rows: accreditationRows } = await client.query<{ id: string }>(
      `SELECT id FROM accreditations WHERE broker_profile_id = ANY($1::uuid[])`,
      [brokerIds],
    );
    const accreditationIds = accreditationRows.map((r) => r.id);

    const { rows: principalRows } = await client.query<{ id: string }>(
      `SELECT id FROM business_principals WHERE broker_business_id = ANY($1::uuid[]) OR broker_profile_id = ANY($2::uuid[])`,
      [businessIds, brokerIds],
    );
    const principalIds = principalRows.map((r) => r.id);

    console.log(
      `Purging ${brokerIds.length} demo broker(s), ${businessIds.length} business(es), ${accreditationIds.length} accreditation(s)...`,
    );

    await client.query(
      `DELETE FROM notifications
       WHERE (recipient_type = 'broker' AND recipient_id = ANY($1::uuid[]))
          OR (related_record_type = 'accreditation' AND related_record_id = ANY($2::uuid[]))`,
      [brokerIds, accreditationIds],
    );
    await client.query(`DELETE FROM notification_preferences WHERE actor_type = 'broker' AND actor_id = ANY($1::uuid[])`, [
      brokerIds,
    ]);
    await client.query(`DELETE FROM training_confirmations WHERE accreditation_id = ANY($1::uuid[])`, [accreditationIds]);
    await client.query(`DELETE FROM accreditation_decisions WHERE accreditation_id = ANY($1::uuid[])`, [accreditationIds]);
    await client.query(`DELETE FROM accreditations WHERE id = ANY($1::uuid[])`, [accreditationIds]);

    await client.query(
      `DELETE FROM evidence
       WHERE (subject_type = 'broker_profile' AND subject_id = ANY($1::uuid[]))
          OR (subject_type = 'broker_business' AND subject_id = ANY($2::uuid[]))
          OR (subject_type = 'business_principal' AND subject_id = ANY($3::uuid[]))`,
      [brokerIds, businessIds, principalIds],
    );
    await client.query(
      `DELETE FROM check_exceptions WHERE check_result_id IN (
         SELECT id FROM check_result
         WHERE (subject_type = 'broker_profile' AND subject_id = ANY($1::uuid[]))
            OR (subject_type = 'broker_business' AND subject_id = ANY($2::uuid[]))
       )`,
      [brokerIds, businessIds],
    );
    await client.query(
      `DELETE FROM check_result
       WHERE (subject_type = 'broker_profile' AND subject_id = ANY($1::uuid[]))
          OR (subject_type = 'broker_business' AND subject_id = ANY($2::uuid[]))`,
      [brokerIds, businessIds],
    );

    await client.query(`DELETE FROM relationships WHERE broker_profile_id = ANY($1::uuid[])`, [brokerIds]);
    await client.query(
      `DELETE FROM business_principals WHERE broker_business_id = ANY($1::uuid[]) OR broker_profile_id = ANY($2::uuid[])`,
      [businessIds, brokerIds],
    );
    await client.query(
      `DELETE FROM business_affiliations WHERE broker_profile_id = ANY($1::uuid[]) OR broker_business_id = ANY($2::uuid[])`,
      [brokerIds, businessIds],
    );
    await client.query(`DELETE FROM broker_businesses WHERE id = ANY($1::uuid[])`, [businessIds]);
    await client.query(`DELETE FROM association_memberships WHERE broker_profile_id = ANY($1::uuid[])`, [brokerIds]);
    await client.query(`DELETE FROM metering_event WHERE broker_profile_id = ANY($1::uuid[])`, [brokerIds]);
    await client.query(`DELETE FROM refresh_tokens WHERE actor_type = 'broker' AND actor_id = ANY($1::uuid[])`, [brokerIds]);
    await client.query(
      `DELETE FROM password_reset_tokens WHERE actor_type = 'broker' AND actor_id = ANY($1::uuid[])`,
      [brokerIds],
    );
    await client.query(
      `DELETE FROM audit_log
       WHERE (actor_type = 'broker' AND actor_id = ANY($1::uuid[]))
          OR (subject_type = 'broker_profile' AND subject_id = ANY($1::uuid[]))
          OR (subject_type = 'broker_business' AND subject_id = ANY($2::uuid[]))
          OR (subject_type = 'accreditation' AND subject_id = ANY($3::uuid[]))`,
      [brokerIds, businessIds, accreditationIds],
    );

    const { rowCount } = await client.query(`DELETE FROM broker_profiles WHERE id = ANY($1::uuid[])`, [brokerIds]);

    await client.query('COMMIT');
    console.log(`Purged ${rowCount} demo broker(s) and everything that hung off them.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
