import { IsOptional, IsString } from 'class-validator';

export class SearchBusinessesDto {
  @IsOptional()
  @IsString()
  abn?: string;

  @IsOptional()
  @IsString()
  acn?: string;
}
