/**
 * Section 23 / G-14 (Section 9.1-9.3): versioned declarative JSON, no DSL. D1/D4
 * (scope granularity, eligibility conditional on scope) are deliberately NOT
 * expressed here — they're handled by the composite key itself (ruleset_versions'
 * brand/role/product_scope/pathway columns): "NAB Equipment Finance requires the same
 * resume as Commercial, and CAFBA membership" is two different ruleset_version rows,
 * not a conditional inside one. What's left for Condition to express is true
 * data-conditionals (experience_years < 2) and any_of/all_of alternative-satisfaction
 * (Maple's police-check-or-membership; Westpac's own D4 example of
 * degree-or-membership for Commercial Referrer).
 */

export type Fact = {
  experienceYears: number | null;
  hasDocument: (documentType: string) => boolean;
  hasActiveAssociationMembership: boolean;
};

export type Condition =
  | { op: 'always' }
  | { op: 'lt'; field: 'experienceYears'; value: number }
  | { op: 'gte'; field: 'experienceYears'; value: number }
  | { op: 'all_of'; conditions: Condition[] }
  | { op: 'any_of'; conditions: Condition[] };

export type SatisfyingOption =
  | { kind: 'document'; documentType: string; label: string; validityDays: number | null }
  | { kind: 'association_membership' };

export type SubjectType = 'broker_profile' | 'broker_business';

// A group is outstanding unless at least one of its satisfyingBy options is met — the
// any_of semantics D3 requires ("Requirements are satisfiable by alternatives, not
// only by a named document," Section 9.2).
export type RequirementGroup = {
  id: string;
  label: string;
  subjectType: SubjectType;
  appliesWhen: Condition;
  satisfiedBy: SatisfyingOption[];
};

// thresholds/declarations/approvalRouting/training are stored config, not evaluated by
// this epic's engine — see the Epic 9 plan's "Scope decision" for why each is deferred
// (thresholds need DOC-003 data extraction; approvalRouting/training are Epic 10/11's
// execution concerns).
export type RulesetDefinition = {
  requirementGroups: RequirementGroup[];
  thresholds: Record<string, number>;
  declarations: Array<{ id: string; label: string }>;
  approvalRouting: unknown;
  training: unknown;
};

export type OutstandingRequirement = {
  groupId: string;
  label: string;
  reason: string;
};
