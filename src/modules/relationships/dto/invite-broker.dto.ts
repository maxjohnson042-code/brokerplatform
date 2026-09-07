import { IsEmail, IsIn } from 'class-validator';
import { RelationshipType } from '../relationships.repository';

const RELATIONSHIP_TYPES: RelationshipType[] = ['lender_panel', 'aggregator_membership', 'association_membership'];

export class InviteBrokerDto {
  @IsEmail()
  brokerEmail!: string;

  @IsIn(RELATIONSHIP_TYPES)
  type!: RelationshipType;
}
