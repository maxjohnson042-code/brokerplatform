/**
 * Populates the lender review queue (and everything upstream of it) with a spread of
 * brokers sitting in every reachable accreditation/relationship state, so the
 * dashboard has something to look at beyond one or two hand-created records.
 *
 * Every broker this script creates uses an @demo.brok3r.test email address — that's
 * the ONLY thing that marks a row as demo data (no schema change, no is_demo column).
 * scripts/purge-demo-data.ts deletes strictly by that marker, so re-running this
 * script is always safe: purge first if you want a clean slate, or just run it again
 * to add another batch (broker emails are unique, so a genuine re-run without purging
 * first will skip brokers it already created rather than erroring out).
 *
 * The lender org ("Demo Lender Bank") and its reviewer login are NOT demo-marked and
 * are found-or-created rather than duplicated on every run — they're the fixed
 * "who's using the product" identity, not disposable noise. Log in as
 * reviewer@demo.brok3r.test / DemoPassword123!. MFA is still real and still enforced
 * (AUTH-006 stays mandatory — this script doesn't touch that) — the account is just
 * pre-enrolled against a FIXED, known secret (DEMO_TOTP_SECRET below) instead of a
 * randomly generated one, so a demo login never depends on catching a one-time
 * enrolment screen. Add that secret to any TOTP app once and you'll always have a
 * valid code; the script also prints one that's valid right now.
 *
 * Run with: npm run seed:demo-data
 */
import 'dotenv/config';
import { authenticator } from 'otplib';
import { withAuthorizationContext, AuthorizationContext } from '../src/db/authorization-context';
import {
  createClientOrganisation,
  createClientUser,
  verifyClientOrganisation,
  registerBroker,
  saveMfaEnrollment,
  confirmMfaEnrollment,
} from '../src/modules/identity/identity.repository';
import { updateBrokerProfile, attestTerms, submitProfile, createAssociationMembership } from '../src/modules/brokers/brokers.repository';
import { createBusiness, submitBusiness, addPrincipal } from '../src/modules/businesses/businesses.repository';
import { requestRelationship, inviteBroker } from '../src/modules/relationships/relationships.repository';
import { requestAccreditation, requestMoreInformation, escalate, approve, decline } from '../src/modules/accreditation/accreditation.repository';
import { confirmTraining, activateAccreditation, checkTrainingDeadlines } from '../src/modules/accreditation/training.repository';
import type { AccreditationClassification } from '../src/modules/accreditation/accreditation.repository';

const DEMO_PASSWORD = 'DemoPassword123!';
const LENDER_ORG_NAME = 'Demo Lender Bank';
const REVIEWER_EMAIL = 'reviewer@demo.brok3r.test';
// Fixed on purpose (a real enrolment would generate a random one per account) — the
// whole point is a demo login that never needs a one-time enrolment screen. Add this
// to any TOTP app (Google Authenticator, Authy, 1Password...) once; from then on it
// generates the same 6-digit codes as authenticator.generate() does below.
const DEMO_TOTP_SECRET = 'GEQWASB5LVKVCFIT';

type TargetState =
  | 'requested'
  | 'information_required'
  | 'exception_escalated'
  | 'declined'
  | 'pending'
  | 'active'
  | 'active_partial_training'
  | 'lapsed'
  | 'invited_only';

type DemoBroker = {
  firstName: string;
  lastName: string;
  business: string;
  productScope: string;
  classification: AccreditationClassification;
  state: TargetState;
};

// A representative spread across every status the review queue can show — see
// db/migrations/0024_accreditations.sql's accreditation_status enum for the full set
// (party_changed_pending isn't included: it needs a live affiliation change to
// trigger, which is a bigger setup than a name/business pair buys here).
const ROSTER: DemoBroker[] = [
  { firstName: 'Ava', lastName: 'Nguyen', business: 'Nguyen Finance Co', productScope: 'commercial', classification: 'new_broker_introducer', state: 'requested' },
  { firstName: 'Liam', lastName: 'Chen', business: 'Chen Broking Group', productScope: 'residential', classification: 'new_broker_introducer', state: 'requested' },
  { firstName: 'Sophie', lastName: 'Patel', business: 'Patel & Co Finance', productScope: 'asset_finance', classification: 'new_broker_introducer', state: 'information_required' },
  { firstName: 'Noah', lastName: 'Kelly', business: 'Kelly Capital Partners', productScope: 'commercial', classification: 'add_on', state: 'information_required' },
  { firstName: 'Mia', lastName: 'Thompson', business: 'Thompson Lending Solutions', productScope: 'residential', classification: 'new_broker_introducer', state: 'exception_escalated' },
  { firstName: 'Ethan', lastName: 'Walsh', business: 'Walsh Finance Group', productScope: 'commercial', classification: 'transfer', state: 'exception_escalated' },
  { firstName: 'Grace', lastName: "O'Brien", business: "O'Brien Broking", productScope: 'asset_finance', classification: 'new_broker_introducer', state: 'declined' },
  { firstName: 'Jack', lastName: 'Ryan', business: 'Ryan Finance Partners', productScope: 'residential', classification: 'new_broker_introducer', state: 'pending' },
  { firstName: 'Isla', lastName: 'Murphy', business: 'Murphy & Associates Finance', productScope: 'commercial', classification: 'new_referrer_introducer', state: 'pending' },
  { firstName: 'Oliver', lastName: 'Bennett', business: 'Bennett Capital', productScope: 'commercial', classification: 'new_broker_introducer', state: 'active' },
  { firstName: 'Charlotte', lastName: 'Reid', business: 'Reid Finance Solutions', productScope: 'asset_finance', classification: 'new_broker_introducer', state: 'active_partial_training' },
  { firstName: 'Lucas', lastName: 'Fitzgerald', business: 'Fitzgerald Broking', productScope: 'residential', classification: 'new_broker_introducer', state: 'lapsed' },
  { firstName: 'Amelia', lastName: 'Ward', business: 'Ward & Partners', productScope: 'commercial', classification: 'new_broker_introducer', state: 'invited_only' },
];

async function findClientOrganisationByName(name: string): Promise<string | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id FROM client_organisations WHERE name = $1`, [name]);
    return (rows[0]?.id as string | undefined) ?? null;
  });
}

async function findClientUserByEmail(email: string): Promise<{ id: string; clientOrganisationId: string } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id, client_organisation_id FROM client_users WHERE email = $1`, [
      email.toLowerCase(),
    ]);
    return rows[0] ? { id: rows[0].id as string, clientOrganisationId: rows[0].client_organisation_id as string } : null;
  });
}

async function findBrokerIdByEmail(email: string): Promise<string | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id FROM broker_profiles WHERE email = $1`, [email.toLowerCase()]);
    return (rows[0]?.id as string | undefined) ?? null;
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

async function ensureLenderOrg(): Promise<{ orgId: string; reviewerCtx: AuthorizationContext }> {
  let orgId = await findClientOrganisationByName(LENDER_ORG_NAME);
  if (!orgId) {
    console.log(`Creating lender organisation "${LENDER_ORG_NAME}"...`);
    const org = await createClientOrganisation({ actorType: 'system' }, { type: 'lender', name: LENDER_ORG_NAME });
    await verifyClientOrganisation({ actorType: 'system' }, org.id);
    orgId = org.id;
  } else {
    console.log(`Reusing existing lender organisation "${LENDER_ORG_NAME}" (${orgId}).`);
  }

  let reviewer = await findClientUserByEmail(REVIEWER_EMAIL);
  if (!reviewer) {
    console.log(`Creating reviewer login ${REVIEWER_EMAIL}...`);
    const created = await createClientUser(
      { actorType: 'system' },
      { clientOrganisationId: orgId, email: REVIEWER_EMAIL, password: DEMO_PASSWORD, role: 'reviewer' },
    );
    reviewer = { id: created.id, clientOrganisationId: orgId };
  } else {
    console.log(`Reusing existing reviewer login ${REVIEWER_EMAIL}.`);
  }

  // Unconditional, not "only if not already enrolled" — saveMfaEnrollment upserts, so
  // this also fixes up an account that got enrolled some other way (e.g. by hand,
  // against a random secret, before this script grew this step).
  console.log(`(Re-)pointing MFA for ${REVIEWER_EMAIL} at the fixed demo secret...`);
  await saveMfaEnrollment(reviewer.id, DEMO_TOTP_SECRET, []);
  await confirmMfaEnrollment(reviewer.id);

  return {
    orgId,
    reviewerCtx: { actorType: 'client_user', actorId: reviewer.id, clientOrganisationId: orgId },
  };
}

async function seedBroker(def: DemoBroker, orgId: string, reviewerCtx: AuthorizationContext): Promise<void> {
  const email = `${def.firstName.toLowerCase()}.${def.lastName.toLowerCase().replace(/[^a-z]/g, '')}@demo.brok3r.test`;

  if (await findBrokerIdByEmail(email)) {
    console.log(`  skip  ${def.firstName} ${def.lastName} — already seeded (${email})`);
    return;
  }

  let broker: { id: string };
  try {
    broker = await registerBroker({ email, password: DEMO_PASSWORD, firstName: def.firstName, lastName: def.lastName });
  } catch (err) {
    if (isUniqueViolation(err)) {
      console.log(`  skip  ${def.firstName} ${def.lastName} — email taken between check and insert`);
      return;
    }
    throw err;
  }
  const brokerCtx: AuthorizationContext = { actorType: 'broker', actorId: broker.id };

  await updateBrokerProfile(brokerCtx, broker.id, {
    dateOfBirth: '1988-06-15',
    phoneNumber: '0298765432',
    mobileNumber: '0412345678',
    experienceYears: 6,
    address: { line1: '1 Demo Street', city: 'Sydney', postcode: '2000', state: 'NSW' },
    licenceTypeHeld: 'own_credit_licence',
    creditLicenceNumber: `ACL${Math.floor(100000 + Math.random() * 900000)}`,
  });
  await createAssociationMembership(brokerCtx, broker.id, {
    associationName: 'MFAA',
    membershipNumber: `MFAA-${Math.floor(100000 + Math.random() * 900000)}`,
  });
  await attestTerms(brokerCtx, broker.id);
  await submitProfile(brokerCtx, broker.id);

  const business = await createBusiness(brokerCtx, broker.id, {
    entityType: 'company',
    legalName: `${def.business} Pty Ltd`,
    tradingName: def.business,
    abn: String(Math.floor(10000000000 + Math.random() * 89999999999)),
    businessEmail: `office@${def.business.toLowerCase().replace(/[^a-z]/g, '')}.example`,
    gstRegistered: true,
    address: { line1: '2 Demo Avenue', city: 'Sydney', postcode: '2000', state: 'NSW' },
  });
  await addPrincipal(brokerCtx, broker.id, business.id, {
    role: 'director',
    firstName: def.firstName,
    lastName: def.lastName,
    dateOfBirth: '1988-06-15',
  });
  await submitBusiness(brokerCtx, broker.id, business.id);

  if (def.state === 'invited_only') {
    // REL-003: lender-initiated invite, deliberately left un-accepted — this is the
    // "waiting on the broker" relationship state, distinct from every accreditation
    // state below (which all need an ACTIVE relationship to even exist).
    await inviteBroker(reviewerCtx, { clientOrganisationId: orgId, brokerEmail: email, type: 'lender_panel' });
    console.log(`  done  ${def.firstName} ${def.lastName} — invited, pending acceptance`);
    return;
  }

  await requestRelationship(brokerCtx, {
    brokerProfileId: broker.id,
    clientOrganisationId: orgId,
    type: 'lender_panel',
    consentVersion: 'v1',
  });

  const accreditation = await requestAccreditation(brokerCtx, {
    brokerProfileId: broker.id,
    lenderClientOrganisationId: orgId,
    brokerBusinessId: business.id,
    classification: def.classification,
    brand: 'default',
    role: 'broker',
    productScope: def.productScope,
    licenceHolderType: 'broking_business',
    licenceHolderBrokerBusinessId: business.id,
  });

  switch (def.state) {
    case 'requested':
      break;
    case 'information_required':
      await requestMoreInformation(reviewerCtx, accreditation.id, [
        'Certificate IV in Finance and Mortgage Broking not yet sighted.',
        'Police check is more than 3 months old — a fresh one is required.',
      ]);
      break;
    case 'exception_escalated':
      await escalate(reviewerCtx, accreditation.id, 'Prior AFCA complaint on file — needs senior review before proceeding.');
      break;
    case 'declined':
      await decline(reviewerCtx, accreditation.id, 'Does not meet minimum experience requirement for this product scope.');
      break;
    case 'pending':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      break;
    case 'active':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      await confirmTraining(reviewerCtx, accreditation.id, 'platform');
      await confirmTraining(reviewerCtx, accreditation.id, 'product');
      await activateAccreditation(reviewerCtx, accreditation.id);
      break;
    case 'active_partial_training':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      await confirmTraining(reviewerCtx, accreditation.id, 'platform');
      // Product training deliberately left unconfirmed — TRN-005/006's "confirming
      // never auto-activates" shown mid-flight, not just as a before/after pair.
      break;
    case 'lapsed':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      // approve() always sets the deadline 60 days out — backdate it directly so
      // checkTrainingDeadlines() (the same function REV-008's "check for lapsed
      // training deadlines" button calls) has something real to flip.
      await withAuthorizationContext({ actorType: 'system' }, (client) =>
        client.query(`UPDATE accreditations SET training_deadline_at = now() - INTERVAL '2 days' WHERE id = $1`, [
          accreditation.id,
        ]),
      );
      await checkTrainingDeadlines(reviewerCtx, orgId);
      break;
  }

  console.log(`  done  ${def.firstName} ${def.lastName} — ${def.state}`);
}

async function main() {
  console.log(`Seeding demo data (${ROSTER.length} brokers) against ${LENDER_ORG_NAME}...\n`);
  const { orgId, reviewerCtx } = await ensureLenderOrg();

  for (const def of ROSTER) {
    await seedBroker(def, orgId, reviewerCtx);
  }

  console.log(`\nDone. Sign in as a lender at /client-login with:`);
  console.log(`  ${REVIEWER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  MFA code (valid right now): ${authenticator.generate(DEMO_TOTP_SECRET)}`);
  console.log(`  MFA secret (add once to an authenticator app for codes on demand): ${DEMO_TOTP_SECRET}`);
  console.log(`\nRun "npm run purge:demo-data" to remove everything this script created.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
