/**
 * AMP demo prep: 50 brokers on AMP Bank's panel, weighted heavily toward 'active'
 * (most accredited, per the demo ask) with a real spread of every other reachable
 * status, plus deliberately varied training_deadline_at values on the still-pending
 * ones so the review queue shows urgent/soon/healthy renewal windows side by side —
 * not just a binary active-vs-lapsed. Modelled directly on scripts/seed-demo-data.ts
 * (same repository-function-direct approach, same reasoning throughout); this one
 * targets the AMP Bank org created earlier this session instead of a fresh "Demo
 * Lender Bank", and uses its own email prefix so re-running either script never
 * collides with the other's brokers.
 *
 * Every broker here uses an amp-<name>@demo.brok3r.test address — matches
 * purge-demo-data.ts's existing %@demo.brok3r.test pattern, so the existing purge
 * script sweeps these up too without any change to it. Re-running this script is
 * safe: broker emails are unique, so it skips anyone already seeded.
 *
 * Run with: npx ts-node scripts/seed-amp-demo.ts
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
import { requestRelationship } from '../src/modules/relationships/relationships.repository';
import { requestAccreditation, requestMoreInformation, escalate, approve, decline } from '../src/modules/accreditation/accreditation.repository';
import { confirmTraining, activateAccreditation, checkTrainingDeadlines } from '../src/modules/accreditation/training.repository';
import type { AccreditationClassification } from '../src/modules/accreditation/accreditation.repository';

const DEMO_PASSWORD = 'DemoPassword123!';
const LENDER_ORG_NAME = 'AMP Bank';
const REVIEWER_EMAIL = 'reviewer@amp.demo';
const REVIEWER_TOTP_SECRET = 'JBSWY3DPEHPK3PXQ'; // fixed, demo-only — same reasoning as seed-demo-data.ts's DEMO_TOTP_SECRET

type TargetState =
  | 'requested'
  | 'information_required'
  | 'exception_escalated'
  | 'declined'
  | 'pending_urgent' // approved, training due in ~3 days
  | 'pending_soon' // approved, training due in ~15 days
  | 'pending_healthy' // approved, training due in ~50 days (the untouched default)
  | 'active'
  | 'active_partial_training'
  | 'lapsed';

type DemoBroker = { firstName: string; lastName: string; state: TargetState; classification: AccreditationClassification; productScope: string };

const NAMES: Array<{ firstName: string; lastName: string }> = [
  { firstName: 'Ava', lastName: 'Nguyen' }, { firstName: 'Liam', lastName: 'Chen' }, { firstName: 'Sophie', lastName: 'Patel' },
  { firstName: 'Noah', lastName: 'Kelly' }, { firstName: 'Mia', lastName: 'Thompson' }, { firstName: 'Ethan', lastName: 'Walsh' },
  { firstName: 'Grace', lastName: "O'Brien" }, { firstName: 'Jack', lastName: 'Ryan' }, { firstName: 'Isla', lastName: 'Murphy' },
  { firstName: 'Oliver', lastName: 'Bennett' }, { firstName: 'Charlotte', lastName: 'Reid' }, { firstName: 'Lucas', lastName: 'Fitzgerald' },
  { firstName: 'Amelia', lastName: 'Ward' }, { firstName: 'Henry', lastName: 'Singh' }, { firstName: 'Zoe', lastName: 'Wilson' },
  { firstName: 'William', lastName: 'Clarke' }, { firstName: 'Ruby', lastName: 'Robinson' }, { firstName: 'James', lastName: 'Mitchell' },
  { firstName: 'Chloe', lastName: 'Campbell' }, { firstName: 'Thomas', lastName: 'Stewart' }, { firstName: 'Lily', lastName: 'Morris' },
  { firstName: 'Alexander', lastName: 'Rogers' }, { firstName: 'Ella', lastName: 'Cook' }, { firstName: 'Benjamin', lastName: 'Bailey' },
  { firstName: 'Hannah', lastName: 'Cooper' }, { firstName: 'Samuel', lastName: 'Richardson' }, { firstName: 'Emily', lastName: 'Cox' },
  { firstName: 'Daniel', lastName: 'Howard' }, { firstName: 'Olivia', lastName: 'Torres' }, { firstName: 'Matthew', lastName: 'Peterson' },
  { firstName: 'Sienna', lastName: 'Gray' }, { firstName: 'Joshua', lastName: 'Ramirez' }, { firstName: 'Matilda', lastName: 'James' },
  { firstName: 'Harrison', lastName: 'Watson' }, { firstName: 'Zara', lastName: 'Brooks' }, { firstName: 'Cooper', lastName: 'Sanders' },
  { firstName: 'Willow', lastName: 'Price' }, { firstName: 'Nathan', lastName: 'Wood' }, { firstName: 'Poppy', lastName: 'Barnes' },
  { firstName: 'Adam', lastName: 'Ross' }, { firstName: 'Layla', lastName: 'Henderson' }, { firstName: 'Ryan', lastName: 'Coleman' },
  { firstName: 'Scarlett', lastName: 'Jenkins' }, { firstName: 'Connor', lastName: 'Perry' }, { firstName: 'Georgia', lastName: 'Powell' },
  { firstName: 'Blake', lastName: 'Long' }, { firstName: 'Evie', lastName: 'Patterson' }, { firstName: 'Xavier', lastName: 'Foster' },
  { firstName: 'Freya', lastName: 'Hughes' }, { firstName: 'Riley', lastName: 'Simpson' },
];

const PRODUCT_SCOPES = ['residential', 'commercial', 'asset_finance'];
const BUSINESS_SUFFIXES = ['Finance Group', 'Broking', 'Capital Partners', 'Lending Solutions'];

// 35 active, 5 active_partial_training, 3 pending (one each of urgent/soon/healthy),
// 2 requested, 2 information_required, 1 exception_escalated, 1 declined, 1 lapsed = 50.
function stateForIndex(i: number): TargetState {
  if (i < 35) return 'active';
  if (i < 40) return 'active_partial_training';
  if (i === 40) return 'pending_urgent';
  if (i === 41) return 'pending_soon';
  if (i === 42) return 'pending_healthy';
  if (i < 45) return 'requested';
  if (i < 47) return 'information_required';
  if (i === 47) return 'exception_escalated';
  if (i === 48) return 'declined';
  return 'lapsed';
}

function classificationForIndex(i: number): AccreditationClassification {
  if (i % 13 === 0) return 'new_referrer_introducer';
  if (i % 11 === 0) return 'transfer';
  if (i % 7 === 0) return 'add_on';
  return 'new_broker_introducer';
}

const ROSTER: DemoBroker[] = NAMES.map((n, i) => ({
  ...n,
  state: stateForIndex(i),
  classification: classificationForIndex(i),
  productScope: PRODUCT_SCOPES[i % PRODUCT_SCOPES.length],
}));

async function findClientOrganisationByName(name: string): Promise<string | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id FROM client_organisations WHERE name = $1`, [name]);
    return (rows[0]?.id as string | undefined) ?? null;
  });
}

async function findClientUserByEmail(email: string): Promise<{ id: string; clientOrganisationId: string } | null> {
  return withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(`SELECT id, client_organisation_id FROM client_users WHERE email = $1`, [email.toLowerCase()]);
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

  console.log(`(Re-)pointing MFA for ${REVIEWER_EMAIL} at the fixed demo secret...`);
  await saveMfaEnrollment(reviewer.id, REVIEWER_TOTP_SECRET, []);
  await confirmMfaEnrollment(reviewer.id);

  return { orgId, reviewerCtx: { actorType: 'client_user', actorId: reviewer.id, clientOrganisationId: orgId } };
}

async function setTrainingDeadline(accreditationId: string, daysFromNow: number): Promise<void> {
  await withAuthorizationContext({ actorType: 'system' }, (client) =>
    client.query(`UPDATE accreditations SET training_deadline_at = now() + ($2 * INTERVAL '1 day') WHERE id = $1`, [
      accreditationId,
      daysFromNow,
    ]),
  );
}

async function seedBroker(def: DemoBroker, orgId: string, reviewerCtx: AuthorizationContext): Promise<void> {
  const email = `amp-${def.firstName.toLowerCase()}.${def.lastName.toLowerCase().replace(/[^a-z]/g, '')}@demo.brok3r.test`;

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

  const businessName = `${def.lastName} ${BUSINESS_SUFFIXES[def.lastName.length % BUSINESS_SUFFIXES.length]}`;
  const business = await createBusiness(brokerCtx, broker.id, {
    entityType: 'company',
    legalName: `${businessName} Pty Ltd`,
    tradingName: businessName,
    abn: String(Math.floor(10000000000 + Math.random() * 89999999999)),
    businessEmail: `office@${businessName.toLowerCase().replace(/[^a-z]/g, '')}.example`,
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
    case 'pending_urgent':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      await setTrainingDeadline(accreditation.id, 3);
      break;
    case 'pending_soon':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      await setTrainingDeadline(accreditation.id, 15);
      break;
    case 'pending_healthy':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      // Left at approve()'s own default (~60 days) — the "plenty of time" end of the range.
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
      break;
    case 'lapsed':
      await approve(reviewerCtx, accreditation.id, 'Meets all requirements for this classification.');
      await setTrainingDeadline(accreditation.id, -2);
      await checkTrainingDeadlines(reviewerCtx, orgId);
      break;
  }

  console.log(`  done  ${def.firstName} ${def.lastName} — ${def.state}`);
}

async function main() {
  console.log(`Seeding AMP demo data (${ROSTER.length} brokers) against ${LENDER_ORG_NAME}...\n`);
  const { orgId, reviewerCtx } = await ensureLenderOrg();

  for (const def of ROSTER) {
    await seedBroker(def, orgId, reviewerCtx);
  }

  console.log(`\nDone. Sign in as AMP's reviewer at /client-login with:`);
  console.log(`  ${REVIEWER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  MFA code (valid right now): ${authenticator.generate(REVIEWER_TOTP_SECRET)}`);
  console.log(`  MFA secret (add once to an authenticator app for codes on demand): ${REVIEWER_TOTP_SECRET}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
