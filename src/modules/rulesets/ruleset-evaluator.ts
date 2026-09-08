import {
  Condition,
  Fact,
  OutstandingRequirement,
  RequirementGroup,
  RulesetDefinition,
  SatisfyingOption,
  SubjectType,
} from './ruleset.types';

export function evaluateCondition(condition: Condition, fact: Fact): boolean {
  switch (condition.op) {
    case 'always':
      return true;
    case 'lt':
      return fact.experienceYears !== null && fact.experienceYears < condition.value;
    case 'gte':
      return fact.experienceYears !== null && fact.experienceYears >= condition.value;
    case 'all_of':
      return condition.conditions.every((c) => evaluateCondition(c, fact));
    case 'any_of':
      return condition.conditions.some((c) => evaluateCondition(c, fact));
  }
}

function isSatisfied(option: SatisfyingOption, fact: Fact): boolean {
  if (option.kind === 'document') return fact.hasDocument(option.documentType);
  return fact.hasActiveAssociationMembership;
}

// Mirrors the shape of computeOutstandingItems (brokers.repository.ts) and
// computeDocumentOutstandingItems (evidence.repository.ts) — a familiar pattern, not a
// new one: filter to what applies, then flag what's unmet.
export function computeOutstandingRequirements(
  definition: RulesetDefinition,
  subjectType: SubjectType,
  fact: Fact,
): OutstandingRequirement[] {
  return definition.requirementGroups
    .filter((group: RequirementGroup) => group.subjectType === subjectType)
    .filter((group) => evaluateCondition(group.appliesWhen, fact))
    .filter((group) => !group.satisfiedBy.some((option) => isSatisfied(option, fact)))
    .map((group) => ({
      groupId: group.id,
      label: group.label,
      reason: describeUnmet(group),
    }));
}

function describeUnmet(group: RequirementGroup): string {
  if (group.satisfiedBy.length === 1) return `${group.label} has not been satisfied.`;
  return `${group.label} has not been satisfied — any one of its accepted alternatives will do.`;
}
