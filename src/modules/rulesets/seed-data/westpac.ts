/**
 * Section 9.3's acceptance test needs a reference/baseline ruleset alongside the NAB
 * one — this is it. Values sourced from Annex A.3 ("Illustrative client-specific
 * configuration") and the D1-D6 table (Section 9.1), not invented. Imported by both
 * scripts/seed-rulesets.ts and test/rulesets/seeded-rulesets-acceptance.spec.ts so
 * there's exactly one copy of this data.
 */
import { SeedRuleset } from './types';

// D6: Westpac's own twelve-item personal declaration (licence refusal, conviction,
// ASIC investigation, company liquidation, bankruptcy, partnership liquidation,
// membership refusal, disciplinary action, dismissal, PI claim, PI refusal,
// accreditation cancellation). Expressly refuses digital signatures for the
// applicant's own declaration — captured here as data; the render/capture mechanism
// itself is out of Epic 9's scope (Section 9.2 point 4: "derive at render time").
const WESTPAC_DECLARATIONS = [
  { id: 'licence_refusal', label: 'Have you ever had a licence application refused?' },
  { id: 'conviction', label: 'Have you ever been convicted of an offence involving fraud or dishonesty?' },
  { id: 'asic_investigation', label: 'Are you currently the subject of an ASIC investigation?' },
  { id: 'company_liquidation', label: 'Have you been an officer of a company that went into liquidation?' },
  { id: 'bankruptcy', label: 'Have you ever been declared bankrupt?' },
  { id: 'partnership_liquidation', label: 'Have you been a partner in a partnership that went into liquidation?' },
  { id: 'membership_refusal', label: 'Has your membership of a professional body ever been refused or revoked?' },
  { id: 'disciplinary_action', label: 'Have you been subject to disciplinary action by a professional body?' },
  { id: 'dismissal', label: 'Have you been dismissed from a position of trust?' },
  { id: 'pi_claim', label: 'Have you ever had a professional indemnity claim made against you?' },
  { id: 'pi_refusal', label: 'Have you ever had professional indemnity cover refused?' },
  { id: 'accreditation_cancellation', label: 'Has an accreditation of yours ever been cancelled?' },
];

const WESTPAC_APPROVAL_ROUTING = {
  approvers: ['National Manager Commercial', 'State Manager Equipment Finance', 'National GM Consumer'],
  additionalSignOff: 'Equipment Finance Credit Manager',
  escalation: ['Senior Manager', 'Accreditation Committee'],
};

const WESTPAC_TRAINING = { deadlineDays: 60 };

export const WESTPAC_COMMERCIAL_BROKER_NEW: SeedRuleset = {
  key: { brand: 'Westpac Commercial', role: 'broker', productScope: 'commercial', pathway: 'new' },
  label: 'Westpac Commercial — Broker — New',
  definition: {
    requirementGroups: [
      {
        id: 'certificate_iv',
        label: 'Certificate IV in Finance and Mortgage Broking',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [{ kind: 'document', documentType: 'certificate_iv', label: 'Certificate IV', validityDays: null }],
      },
      {
        id: 'police_check',
        label: 'Police / criminal history certificate',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        // Annex A's procedure documents: 6 months. (BRD v0.2 separately said 3 months
        // — the master doc itself flags this as an unresolved internal conflict and
        // "a good example of why this is configurable." 180 days is this ruleset's
        // resolved value; a lender free to configure 90 instead is exactly the point.)
        satisfiedBy: [{ kind: 'document', documentType: 'police_check', label: 'Police check', validityDays: 180 }],
      },
      {
        // D4: association membership is MANDATORY for Commercial Broker — a single
        // satisfyingBy option, not an any_of alternative. Contrast with the Commercial
        // Referrer ruleset below.
        id: 'professional_standing',
        label: 'Association membership',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [{ kind: 'association_membership' }],
      },
    ],
    thresholds: { piCoverMinimumDollars: 2_000_000 }, // Annex A.3: "$2M commercial"
    declarations: WESTPAC_DECLARATIONS,
    approvalRouting: WESTPAC_APPROVAL_ROUTING,
    training: WESTPAC_TRAINING,
  },
};

export const WESTPAC_COMMERCIAL_REFERRER_NEW: SeedRuleset = {
  key: { brand: 'Westpac Commercial', role: 'referrer', productScope: 'commercial', pathway: 'new' },
  label: 'Westpac Commercial — Referrer — New',
  definition: {
    requirementGroups: [
      {
        id: 'certificate_iv',
        label: 'Certificate IV in Finance and Mortgage Broking',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [{ kind: 'document', documentType: 'certificate_iv', label: 'Certificate IV', validityDays: null }],
      },
      {
        id: 'police_check',
        label: 'Police / criminal history certificate',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [{ kind: 'document', documentType: 'police_check', label: 'Police check', validityDays: 180 }],
      },
      {
        // D4's own Westpac example: "requires degree qualification OR professional
        // association membership for Commercial Referrer instead" — the concrete,
        // doc-sourced proof that any_of works, not an invented case.
        id: 'professional_standing',
        label: 'Degree qualification or association membership',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [
          { kind: 'document', documentType: 'degree_certificate', label: 'Degree qualification', validityDays: null },
          { kind: 'association_membership' },
        ],
      },
    ],
    thresholds: { piCoverMinimumDollars: 2_000_000 },
    declarations: WESTPAC_DECLARATIONS,
    approvalRouting: WESTPAC_APPROVAL_ROUTING,
    training: WESTPAC_TRAINING,
  },
};

export const WESTPAC_SEED_RULESETS: SeedRuleset[] = [WESTPAC_COMMERCIAL_BROKER_NEW, WESTPAC_COMMERCIAL_REFERRER_NEW];
