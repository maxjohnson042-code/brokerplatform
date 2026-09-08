import { evaluateCondition, computeOutstandingRequirements } from '../../src/modules/rulesets/ruleset-evaluator';
import { Fact, RulesetDefinition } from '../../src/modules/rulesets/ruleset.types';

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    experienceYears: null,
    hasDocument: () => false,
    hasActiveAssociationMembership: false,
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  it('always is always true', () => {
    expect(evaluateCondition({ op: 'always' }, fact())).toBe(true);
  });

  it('lt/gte on experienceYears — null never satisfies either direction', () => {
    expect(evaluateCondition({ op: 'lt', field: 'experienceYears', value: 2 }, fact({ experienceYears: 1 }))).toBe(true);
    expect(evaluateCondition({ op: 'lt', field: 'experienceYears', value: 2 }, fact({ experienceYears: 2 }))).toBe(false);
    expect(evaluateCondition({ op: 'lt', field: 'experienceYears', value: 2 }, fact({ experienceYears: null }))).toBe(false);
    expect(evaluateCondition({ op: 'gte', field: 'experienceYears', value: 2 }, fact({ experienceYears: 2 }))).toBe(true);
    expect(evaluateCondition({ op: 'gte', field: 'experienceYears', value: 2 }, fact({ experienceYears: null }))).toBe(false);
  });

  it('all_of requires every nested condition', () => {
    const condition = {
      op: 'all_of' as const,
      conditions: [
        { op: 'gte' as const, field: 'experienceYears' as const, value: 2 },
        { op: 'lt' as const, field: 'experienceYears' as const, value: 10 },
      ],
    };
    expect(evaluateCondition(condition, fact({ experienceYears: 5 }))).toBe(true);
    expect(evaluateCondition(condition, fact({ experienceYears: 15 }))).toBe(false);
  });

  it('any_of requires at least one nested condition', () => {
    const condition = {
      op: 'any_of' as const,
      conditions: [
        { op: 'lt' as const, field: 'experienceYears' as const, value: 2 },
        { op: 'gte' as const, field: 'experienceYears' as const, value: 10 },
      ],
    };
    expect(evaluateCondition(condition, fact({ experienceYears: 1 }))).toBe(true);
    expect(evaluateCondition(condition, fact({ experienceYears: 12 }))).toBe(true);
    expect(evaluateCondition(condition, fact({ experienceYears: 5 }))).toBe(false);
  });
});

describe('computeOutstandingRequirements', () => {
  const definition: RulesetDefinition = {
    requirementGroups: [
      {
        id: 'certificate_iv',
        label: 'Certificate IV',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [{ kind: 'document', documentType: 'certificate_iv', label: 'Certificate IV', validityDays: null }],
      },
      {
        id: 'mentoring_letter',
        label: 'Mentoring letter',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'lt', field: 'experienceYears', value: 2 },
        satisfiedBy: [{ kind: 'document', documentType: 'mentoring_letter', label: 'Mentoring letter', validityDays: null }],
      },
      {
        id: 'standing_check',
        label: 'Standing check',
        subjectType: 'broker_profile',
        appliesWhen: { op: 'always' },
        satisfiedBy: [
          { kind: 'document', documentType: 'police_check', label: 'Police check', validityDays: 180 },
          { kind: 'association_membership' },
        ],
      },
      {
        id: 'pi_certificate',
        label: 'PI certificate',
        subjectType: 'broker_business',
        appliesWhen: { op: 'always' },
        satisfiedBy: [{ kind: 'document', documentType: 'pi_certificate', label: 'PI certificate', validityDays: 365 }],
      },
    ],
    thresholds: {},
    declarations: [],
    approvalRouting: null,
    training: null,
  };

  it('filters by subjectType', () => {
    const result = computeOutstandingRequirements(definition, 'broker_business', fact());
    expect(result.map((r) => r.groupId)).toEqual(['pi_certificate']);
  });

  it('skips a group whose appliesWhen condition is not met (experienceYears unknown ≠ required)', () => {
    const result = computeOutstandingRequirements(definition, 'broker_profile', fact({ experienceYears: null }));
    expect(result.map((r) => r.groupId)).not.toContain('mentoring_letter');
  });

  it('flags a group whose appliesWhen condition is met and nothing satisfies it', () => {
    const result = computeOutstandingRequirements(definition, 'broker_profile', fact({ experienceYears: 1 }));
    expect(result.map((r) => r.groupId)).toContain('mentoring_letter');
  });

  it('any_of: satisfied by either alternative — document present', () => {
    const result = computeOutstandingRequirements(
      definition,
      'broker_profile',
      fact({ hasDocument: (t) => t === 'police_check' && true }),
    );
    expect(result.map((r) => r.groupId)).not.toContain('standing_check');
  });

  it('any_of: satisfied by either alternative — association membership present, no document', () => {
    const result = computeOutstandingRequirements(definition, 'broker_profile', fact({ hasActiveAssociationMembership: true }));
    expect(result.map((r) => r.groupId)).not.toContain('standing_check');
  });

  it('any_of: outstanding when neither alternative is met', () => {
    const result = computeOutstandingRequirements(definition, 'broker_profile', fact());
    expect(result.map((r) => r.groupId)).toContain('standing_check');
  });
});
