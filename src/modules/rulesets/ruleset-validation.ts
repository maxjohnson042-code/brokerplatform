import { RulesetDefinition } from './ruleset.types';

export class InvalidRulesetDefinitionError extends Error {
  constructor(reason: string) {
    super(`invalid ruleset definition: ${reason}`);
    this.name = 'InvalidRulesetDefinitionError';
  }
}

const CONDITION_OPS = new Set(['always', 'lt', 'gte', 'all_of', 'any_of']);
const SATISFYING_KINDS = new Set(['document', 'association_membership']);

function fail(reason: string): never {
  throw new InvalidRulesetDefinitionError(reason);
}

function validateCondition(condition: unknown, path: string): void {
  if (typeof condition !== 'object' || condition === null) fail(`${path} must be an object`);
  const c = condition as Record<string, unknown>;
  if (typeof c.op !== 'string' || !CONDITION_OPS.has(c.op)) fail(`${path}.op must be one of ${[...CONDITION_OPS].join(', ')}`);
  if ((c.op === 'lt' || c.op === 'gte') && typeof c.value !== 'number') fail(`${path}.value must be a number`);
  if (c.op === 'all_of' || c.op === 'any_of') {
    if (!Array.isArray(c.conditions) || c.conditions.length === 0) fail(`${path}.conditions must be a non-empty array`);
    (c.conditions as unknown[]).forEach((nested, i) => validateCondition(nested, `${path}.conditions[${i}]`));
  }
}

// Publish-time validation, not just runtime evaluation — a malformed ruleset fails
// fast at publish, never silently at evaluation (per the Epic 9 plan).
export function validateRulesetDefinition(definition: unknown): RulesetDefinition {
  if (typeof definition !== 'object' || definition === null) fail('must be an object');
  const d = definition as Record<string, unknown>;

  if (!Array.isArray(d.requirementGroups)) fail('requirementGroups must be an array');
  (d.requirementGroups as unknown[]).forEach((group, i) => {
    const path = `requirementGroups[${i}]`;
    if (typeof group !== 'object' || group === null) fail(`${path} must be an object`);
    const g = group as Record<string, unknown>;
    if (typeof g.id !== 'string' || !g.id) fail(`${path}.id must be a non-empty string`);
    if (typeof g.label !== 'string' || !g.label) fail(`${path}.label must be a non-empty string`);
    if (g.subjectType !== 'broker_profile' && g.subjectType !== 'broker_business') {
      fail(`${path}.subjectType must be 'broker_profile' or 'broker_business'`);
    }
    validateCondition(g.appliesWhen, `${path}.appliesWhen`);
    if (!Array.isArray(g.satisfiedBy) || g.satisfiedBy.length === 0) fail(`${path}.satisfiedBy must be a non-empty array`);
    (g.satisfiedBy as unknown[]).forEach((option, j) => {
      const optPath = `${path}.satisfiedBy[${j}]`;
      if (typeof option !== 'object' || option === null) fail(`${optPath} must be an object`);
      const o = option as Record<string, unknown>;
      if (typeof o.kind !== 'string' || !SATISFYING_KINDS.has(o.kind)) fail(`${optPath}.kind must be one of ${[...SATISFYING_KINDS].join(', ')}`);
      if (o.kind === 'document' && (typeof o.documentType !== 'string' || !o.documentType)) fail(`${optPath}.documentType must be a non-empty string`);
    });
  });

  if (typeof d.thresholds !== 'object' || d.thresholds === null || Array.isArray(d.thresholds)) fail('thresholds must be an object');
  if (!Array.isArray(d.declarations)) fail('declarations must be an array');
  (d.declarations as unknown[]).forEach((decl, i) => {
    if (typeof decl !== 'object' || decl === null) fail(`declarations[${i}] must be an object`);
    const dd = decl as Record<string, unknown>;
    if (typeof dd.id !== 'string' || !dd.id) fail(`declarations[${i}].id must be a non-empty string`);
    if (typeof dd.label !== 'string' || !dd.label) fail(`declarations[${i}].label must be a non-empty string`);
  });

  return definition as RulesetDefinition;
}
