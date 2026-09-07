/**
 * Proves the two claims Epic 1 exists to prove, end to end against a real Postgres
 * instance, rather than leaving them as assertions in a document:
 *
 *   1. PLT-002/PLT-003 (Section 20.2's "hard architectural constraint, not a UI
 *      rule"): a client organisation with no active relationship to a broker gets
 *      back nothing, full stop — not a filtered view, not an error, nothing.
 *   2. Section 20.3's temporal pattern: recording a second check result for the same
 *      subject+type supersedes the first (valid_to set, superseded_by pointed at the
 *      new row) rather than overwriting it.
 *
 * Run with: npm run migrate && npm run demo:tenancy
 */
import { randomUUID } from 'crypto';
import { pool } from '../src/db/pool';
import { withAuthorizationContext } from '../src/db/authorization-context';
import { createClientOrganisation, createClientUser, registerBroker } from '../src/modules/identity/identity.repository';
import { requestRelationship } from '../src/modules/relationships/relationships.repository';
import { getBrokerProfile } from '../src/modules/brokers/brokers.repository';
import { recordCheckResult } from '../src/modules/verification/check-result.repository';

let failures = 0;
function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    failures += 1;
  }
}

async function main() {
  const suffix = randomUUID().slice(0, 8);

  console.log('\nSetting up: two lenders and one broker...');
  const systemCtx = { actorType: 'system' as const };
  const lenderA = await createClientOrganisation(systemCtx, { type: 'lender', name: `Lender A ${suffix}` });
  const lenderB = await createClientOrganisation(systemCtx, { type: 'lender', name: `Lender B ${suffix}` });
  const lenderAUser = await createClientUser(systemCtx, {
    clientOrganisationId: lenderA.id,
    email: `reviewer-a-${suffix}@example.com`,
    password: 'dev-password',
    role: 'reviewer',
  });
  const lenderBUser = await createClientUser(systemCtx, {
    clientOrganisationId: lenderB.id,
    email: `reviewer-b-${suffix}@example.com`,
    password: 'dev-password',
    role: 'reviewer',
  });
  const broker = await registerBroker({
    email: `broker-${suffix}@example.com`,
    password: 'dev-password',
    firstName: 'Test',
    lastName: 'Broker',
  });

  console.log('Broker links to Lender A only...');
  await requestRelationship({ actorType: 'broker', actorId: broker.id }, {
    brokerProfileId: broker.id,
    clientOrganisationId: lenderA.id,
    type: 'lender_panel',
    consentVersion: 'v1',
  });

  console.log('\n--- Tenancy boundary (PLT-002/PLT-003) ---');

  const asBroker = await getBrokerProfile({ actorType: 'broker', actorId: broker.id }, broker.id);
  assert('broker can read their own profile', asBroker !== null);

  const asLenderA = await getBrokerProfile(
    { actorType: 'client_user', actorId: lenderAUser.id, clientOrganisationId: lenderA.id },
    broker.id,
  );
  assert('Lender A (has an active relationship) can read the profile', asLenderA !== null);

  const asLenderB = await getBrokerProfile(
    { actorType: 'client_user', actorId: lenderBUser.id, clientOrganisationId: lenderB.id },
    broker.id,
  );
  assert('Lender B (no relationship) gets nothing back — not an error, not a filtered view', asLenderB === null);

  console.log('\n--- Temporal check_result (Section 20.3) ---');

  const first = await recordCheckResult({
    subjectType: 'broker_profile',
    subjectId: broker.id,
    checkType: 'credit_representative_authorisation',
    provider: 'manual',
    outcome: 'current',
  });
  const second = await recordCheckResult({
    subjectType: 'broker_profile',
    subjectId: broker.id,
    checkType: 'credit_representative_authorisation',
    provider: 'manual',
    outcome: 'current', // re-verified on cadence — same outcome, new evidence in a real check
  });

  // These verification reads go through withAuthorizationContext as the 'system'
  // actor, same as every other query in this codebase — a bare pool.query() here
  // would hit the same RLS policies with no session variables set, and correctly get
  // back nothing. (That's not a bug to work around; it's the layer-two backstop from
  // Section 20.2 doing exactly its job — this comment exists because it caught this
  // exact mistake while writing this script.)
  const { firstRow, currentRows } = await withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows: firstRow } = await client.query(
      'SELECT valid_to, superseded_by FROM check_result WHERE id = $1',
      [first.id],
    );
    const { rows: currentRows } = await client.query(
      `SELECT id FROM check_result
       WHERE subject_type = 'broker_profile' AND subject_id = $1
         AND check_type = 'credit_representative_authorisation' AND valid_to IS NULL`,
      [broker.id],
    );
    return { firstRow, currentRows };
  });

  assert('the first check_result row was closed out (valid_to set)', firstRow[0].valid_to !== null);
  assert('the first row points at the second as its successor', firstRow[0].superseded_by === second.id);
  assert('exactly one row is current for this subject+check_type', currentRows.length === 1);
  assert('the current row is the second one, not the first', currentRows[0]?.id === second.id);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}\n`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
