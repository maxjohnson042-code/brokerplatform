import { IsOptional, IsString } from 'class-validator';

export class SetBrandingDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;
}
