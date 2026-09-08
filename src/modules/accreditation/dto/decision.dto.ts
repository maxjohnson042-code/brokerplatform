import { IsOptional, IsString, MinLength } from 'class-validator';

// Shared by escalate/approve, where a rationale is encouraged but not enforced by the
// data model — DeclineDto below requires one, since REV-004 makes that mandatory for
// a decline specifically.
export class OptionalRationaleDto {
  @IsOptional()
  @IsString()
  rationale?: string;
}

export class DeclineDto {
  @IsString()
  @MinLength(1)
  rationale!: string;
}

export class InterviewOutcomeDto {
  @IsString()
  @MinLength(1)
  recommendation!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
