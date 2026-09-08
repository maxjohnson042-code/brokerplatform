import { IsString, MinLength } from 'class-validator';

export class ResolveRulesetDto {
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
}
