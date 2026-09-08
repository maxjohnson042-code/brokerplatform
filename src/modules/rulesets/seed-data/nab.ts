/**
 * Section 9.3: "the second seeded ruleset should be NAB, because NAB alone exercises
 * D1, D4, D5 and D6." This file is the actual acceptance-test fixture — three
 * ruleset_versions covering two brands/product scopes (D1), a scope-conditional extra
 * requirement (D4), two pathways (D5), and a declaration set with no overlap with
 * Westpac's (D6). All from the D1-D6 table (Section 9.1), not invented.
 */
import { RulesetDefinition } from '../ruleset.types';
import { SeedRuleset } from './types';

// D6: "NAB instead seeks VEVO work-rights consent and, for Equipment Finance only,
// appointment as a limited agent under NAB's AML/CTF Program, plus AML certification
// and AFCA membership evidence." Zero overlap with Westpac's twelve-item declaration
// set above — the concrete D6 proof.
const NAB_BASE_DECLARATIONS = [{ id: 'vevo_work_rights_consent', label: 'VEVO work-rights consent' }];
const NAB_EQUIPMENT_FINANCE_EXTRA_DECLARATIONS = [
  { id: 'limited_agent_appointment', label: 'Appointment as a limited agent under NAB’s AML/CTF Program' },
  { id: 'aml_certification', label: 'AML certification' },
  { id: 'afca_membership_evidence', label: 'AFCA membership evidence' },
];

const NAB_APPROVAL_ROUTING = { approvers: ['NAB Broker Accreditation Team'] };
const NAB_TRAINING = { deadlineDays: 60 };

// D4: "NAB Commercial requires a resume evidencing 2 years business banking
// experience." A single mandatory document — no any_of here, unlike Westpac
// Referrer's, which is deliberate: not every requirement needs an alternative.
const RESUME_REQUIREMENT: RulesetDefinition['requirementGroups'][number] = {
  id: 'experience_resume',
  label: 'Resume evidencing 2 years business banking experience',
  subjectType: 'broker_profile',
  appliesWhen: { op: 'always' },
  satisfiedBy: [{ kind: 'document', documentType: 'resume', label: 'Resume', validityDays: null }],
};

export const NAB_COMMERCIAL_BROKER_NEW: SeedRuleset = {
  key: { brand: 'NAB Commercial', role: 'broker', productScope: 'commercial', pathway: 'new' },
  label: 'NAB Commercial — Broker — New',
  definition: {
    requirementGroups: [RESUME_REQUIREMENT],
    thresholds: {},
    declarations: NAB_BASE_DECLARATIONS,
    approvalRouting: NAB_APPROVAL_ROUTING,
    training: NAB_TRAINING,
  },
};

export const NAB_EQUIPMENT_FINANCE_BROKER_NEW: SeedRuleset = {
  // D1: a different brand/product_scope row, not a conditional inside one ruleset —
  // this is the composite key doing the work Section 9.2 says it should.
  key: { brand: 'NAB Equipment Finance', role: 'broker', productScope: 'equipment_finance', pathway: 'new' },
  label: 'NAB Equipment Finance — Broker — New',
  definition: {
    requirementGroups: [
      RESUME_REQUIREMENT,
      // D4: "the same [resume] AND CAFBA membership" — the added requirement that
      // distinguishes Equipment Finance from Commercial.
      {
        id: 'cafba_membership',
        label: 'CAFBA membership',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [{ kind: 'association_membership' }],
      },
    ],
    thresholds: {},
    // Strictly larger than Commercial's declaration set — the three Equipment
    // Finance-only items on top of the VEVO consent every NAB brand requires.
    declarations: [...NAB_BASE_DECLARATIONS, ...NAB_EQUIPMENT_FINANCE_EXTRA_DECLARATIONS],
    approvalRouting: NAB_APPROVAL_ROUTING,
    training: NAB_TRAINING,
  },
};

export const NAB_COMMERCIAL_BROKER_TRANSFER: SeedRuleset = {
  // D5: "a two-page form for brokers already holding NAB residential accreditation."
  // The source material doesn't detail the two-page form's exact field list beyond
  // "shorter" — modeled here as omitting the New pathway's experience-resume
  // requirement, which is the one concrete, sourced distinction. The six-month
  // active-broker transfer-eligibility window is stored as data, not evaluated here —
  // that's a pathway-eligibility decision for Epic 10's accreditation classification
  // (ACR-004/005), not the ruleset engine.
  key: { brand: 'NAB Commercial', role: 'broker', productScope: 'commercial', pathway: 'transfer' },
  label: 'NAB Commercial — Broker — Transfer',
  definition: {
    requirementGroups: [],
    thresholds: { transferWindowDays: 180 },
    declarations: NAB_BASE_DECLARATIONS,
    approvalRouting: NAB_APPROVAL_ROUTING,
    training: NAB_TRAINING,
  },
};

export const NAB_SEED_RULESETS: SeedRuleset[] = [
  NAB_COMMERCIAL_BROKER_NEW,
  NAB_EQUIPMENT_FINANCE_BROKER_NEW,
  NAB_COMMERCIAL_BROKER_TRANSFER,
];
