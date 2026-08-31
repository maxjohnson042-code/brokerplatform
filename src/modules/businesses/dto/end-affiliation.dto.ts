import { IsOptional, IsString } from 'class-validator';

export class EndAffiliationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
