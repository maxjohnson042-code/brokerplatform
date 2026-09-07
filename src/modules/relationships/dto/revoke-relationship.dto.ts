import { IsOptional, IsString } from 'class-validator';

export class RevokeRelationshipDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
