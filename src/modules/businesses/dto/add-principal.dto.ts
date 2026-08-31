import { IsEmail, IsISO8601, IsOptional, IsString } from 'class-validator';

// role is free text (director | secretary | partner | trustee, per migration 0003's
// comment) rather than a fixed enum — the schema itself never constrained it, and
// Epic 4's backlog text doesn't ask for validation beyond capture.
export class AddPrincipalDto {
  @IsString()
  role!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
