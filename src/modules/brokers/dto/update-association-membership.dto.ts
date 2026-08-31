import { IsIn, IsOptional, IsString } from 'class-validator';

const ASSOCIATIONS = ['MFAA', 'FBAA', 'CAFBA', 'AFCA'];

export class UpdateAssociationMembershipDto {
  @IsOptional()
  @IsIn(ASSOCIATIONS)
  associationName?: string;

  @IsOptional()
  @IsString()
  membershipNumber?: string;
}
