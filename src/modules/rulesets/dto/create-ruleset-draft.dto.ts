import { IsObject, IsString, MinLength } from 'class-validator';

// `definition` is validated structurally at publish time (ruleset-validation.ts), not
// here — class-validator decorators can't practically express a polymorphic,
// recursively-nested JSON shape (Section 23: declarative JSON, not a DSL the type
// system enforces at the transport boundary).
export class CreateRulesetDraftDto {
  @IsString()
  clientOrganisationId!: string;

  @IsString()
  @MinLength(1)
  brand!: string;

  @IsString()
  @MinLength(1)
  role!: string;

  @IsString()
  @MinLength(1)
  productScope!: string;

  @IsString()
  @MinLength(1)
  pathway!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsObject()
  definition!: Record<string, unknown>;
}
