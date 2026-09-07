import { IsString, MinLength } from 'class-validator';

export class EndRelationshipDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
