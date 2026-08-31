import { IsIn, IsString } from 'class-validator';

// Section 2.3's four named associations — MFAA/FBAA/CAFBA as membership bodies, AFCA
// as the external dispute resolution scheme (also captured here since §13.3 lists it
// as its own repeating "Association" entry, not a separate field).
const ASSOCIATIONS = ['MFAA', 'FBAA', 'CAFBA', 'AFCA'];

export class CreateAssociationMembershipDto {
  @IsIn(ASSOCIATIONS)
  associationName!: string;

  @IsString()
  membershipNumber!: string;
}
