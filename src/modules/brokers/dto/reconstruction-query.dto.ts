import { IsISO8601 } from 'class-validator';

export class ReconstructionQueryDto {
  @IsISO8601()
  asOf!: string;
}
