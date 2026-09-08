import { IsIn, IsOptional, IsString } from 'class-validator';

export class ConfirmTrainingDto {
  @IsIn(['platform', 'product'])
  kind!: 'platform' | 'product';

  @IsOptional()
  @IsString()
  notes?: string;
}
