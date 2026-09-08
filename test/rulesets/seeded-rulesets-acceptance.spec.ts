/**
 * Section 9.3's actual Done bar: "the epic is not done until a NAB ruleset is
 * expressible as configuration with no change to engine code." This test imports the
 * exact same fixtures scripts/seed-rulesets.ts publishes and evaluates all five
 * through the SAME computeOutstandingRequirements call — no per-lender branching in
 * this file — which is the direct proof.
 */
import { computeOutstandingRequirements } from '../../src/modules/rulesets/ruleset-evaluator';
import { Fact } from '../../src/modules/rulesets/ruleset.types';
import { WESTPAC_COMMERCIAL_BROKER_NEW, WESTPAC_COMMERCIAL_REFERRER_NEW } from '../../src/modules/rulesets/seed-data/westpac';
import {
  NAB_COMMERCIAL_BROKER_NEW,
  NAB_EQUIPMENT_FINANCE_BROKER_NEW,
  NAB_COMMERCIAL_BROKER_TRANSFER,
} from '../../src/modules/rulesets/seed-data/nab';

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    experienceYears: null,
    hasDocument: () => false,
    hasActiveAssociationMembership: false,
    ...overrides,
  };
}

describe('seeded rulesets — Section 9.3 acceptance test', () => {
  it('D1: NAB Commercial and NAB Equipment Finance are different ruleset versions (different product_scope), not a branch inside one', () => {
    expect(NAB_COMMERCIAL_BROKER_NEW.key.productScope).toBe('commercial');
    expect(NAB_EQUIPMENT_FINANCE_BROKER_NEW.key.productScope).toBe('equipment_finance');
    expect(NAB_COMMERCIAL_BROKER_NEW.definition).not.toEqual(NAB_EQUIPMENT_FINANCE_BROKER_NEW.definition);
  });

  it('D4: NAB Equipment Finance requires CAFBA membership on top of the resume; NAB Commercial does not', () => {
    const commercial = computeOutstandingRequirements(NAB_COMMERCIAL_BROKER_NEW.definition, 'broker_profile', fact());
    const equipmentFinance = computeOutstandingRequirements(NAB_EQUIPMENT_FINANCE_BROKER_NEW.definition, 'broker_profile', fact());

    expect(commercial.map((r) => r.groupId)).toEqual(['experience_resume']);
    expect(equipmentFinance.map((r) => r.groupId).sort()).toEqual(['cafba_membership', 'experience_resume']);

    // Satisfying CAFBA (an association membership) clears Equipment Finance's extra
    // requirement but leaves the resume outstanding — they're independent groups.
    const withMembership = computeOutstandingRequirements(
      NAB_EQUIPMENT_FINANCE_BROKER_NEW.definition,
      'broker_profile',
      fact({ hasActiveAssociationMembership: true }),
    );
    expect(withMembership.map((r) => r.groupId)).toEqual(['experience_resume']);
  });

  it('D5: NAB Transfer\'s requirement list is a strict subset of NAB New\'s (no resume required)', () => {
    const newPathway = computeOutstandingRequirements(NAB_COMMERCIAL_BROKER_NEW.definition, 'broker_profile', fact());
    const transferPathway = computeOutstandingRequirements(NAB_COMMERCIAL_BROKER_TRANSFER.definition, 'broker_profile', fact());

    expect(newPathway.map((r) => r.groupId)).toEqual(['experience_resume']);
    expect(transferPathway).toEqual([]);
    expect(transferPathway.length).toBeLessThan(newPathway.length);
  });

  it('D6: NAB\'s declaration set has no overlap with Westpac\'s, and Equipment Finance\'s is strictly larger than Commercial\'s', () => {
    const westpacIds = new Set(WESTPAC_COMMERCIAL_BROKER_NEW.definition.declarations.map((d) => d.id));
    const nabCommercialIds = new Set(NAB_COMMERCIAL_BROKER_NEW.definition.declarations.map((d) => d.id));
    const nabEquipmentFinanceIds = new Set(NAB_EQUIPMENT_FINANCE_BROKER_NEW.definition.declarations.map((d) => d.id));

    for (const id of nabCommercialIds) expect(westpacIds.has(id)).toBe(false);
    for (const id of nabCommercialIds) expect(nabEquipmentFinanceIds.has(id)).toBe(true);
    expect(nabEquipmentFinanceIds.size).toBeGreaterThan(nabCommercialIds.size);
  });

  it('D3/D4: Westpac Commercial Broker\'s association membership is mandatory — a degree alone does not satisfy it', () => {
    const result = computeOutstandingRequirements(
      WESTPAC_COMMERCIAL_BROKER_NEW.definition,
      'broker_profile',
      fact({ hasDocument: (t) => t === 'degree_certificate' }),
    );
    expect(result.map((r) => r.groupId)).toContain('professional_standing');
  });

  it('D3/D4: Westpac Commercial Referrer\'s equivalent group is any_of — a degree alone DOES satisfy it', () => {
    const result = computeOutstandingRequirements(
      WESTPAC_COMMERCIAL_REFERRER_NEW.definition,
      'broker_profile',
      fact({ hasDocument: (t) => t === 'degree_certificate' }),
    );
    expect(result.map((r) => r.groupId)).not.toContain('professional_standing');

    // ...and association membership alone also satisfies it, independently.
    const viaMembership = computeOutstandingRequirements(
      WESTPAC_COMMERCIAL_REFERRER_NEW.definition,
      'broker_profile',
      fact({ hasActiveAssociationMembership: true }),
    );
    expect(viaMembership.map((r) => r.groupId)).not.toContain('professional_standing');
  });

  it('all five seeded rulesets evaluate through the exact same function, no per-lender branching in this test', () => {
    const allDefinitions = [
      WESTPAC_COMMERCIAL_BROKER_NEW.definition,
      WESTPAC_COMMERCIAL_REFERRER_NEW.definition,
      NAB_COMMERCIAL_BROKER_NEW.definition,
      NAB_EQUIPMENT_FINANCE_BROKER_NEW.definition,
      NAB_COMMERCIAL_BROKER_TRANSFER.definition,
    ];
    for (const definition of allDefinitions) {
      expect(() => computeOutstandingRequirements(definition, 'broker_profile', fact())).not.toThrow();
    }
  });
});
