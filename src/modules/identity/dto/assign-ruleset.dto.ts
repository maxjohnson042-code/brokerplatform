import { IsString } from 'class-validator';

// Epic 9 (the ruleset engine) doesn't exist yet — this is a placeholder reference
// stored in client_organisations.settings.rulesetId, not a foreign key.
export class AssignRulesetDto {
  @IsString()
  rulesetId!: string;
}
