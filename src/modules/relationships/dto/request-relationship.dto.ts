import { IsIn, IsString } from 'class-validator';
import { RelationshipType } from '../relationships.repository';

const RELATIONSHIP_TYPES: RelationshipType[] = ['lender_panel', 'aggregator_membership', 'association_membership'];

export class RequestRelationshipDto {
  @IsString()
  clientOrganisationId!: string;

  @IsIn(RELATIONSHIP_TYPES)
  type!: RelationshipType;

  @IsString()
  consentVersion!: string;
}
