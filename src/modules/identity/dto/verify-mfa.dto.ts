import { IsOptional, IsString } from 'class-validator';

export class VerifyMfaDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  backupCode?: string;
}
