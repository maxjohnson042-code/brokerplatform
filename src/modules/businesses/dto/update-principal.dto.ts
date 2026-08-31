import { IsEmail, IsISO8601, IsOptional, IsString } from 'class-validator';

export class UpdatePrincipalDto {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
