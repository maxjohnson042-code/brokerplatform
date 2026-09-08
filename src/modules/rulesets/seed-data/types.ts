import { RulesetDefinition } from '../ruleset.types';
import { RulesetKey } from '../rulesets.repository';

export type SeedRuleset = { key: Omit<RulesetKey, 'clientOrganisationId'>; label: string; definition: RulesetDefinition };
