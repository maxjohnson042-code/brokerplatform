import { IsIn, IsString } from 'class-validator';
import { ClientOrganisationType } from '../identity.repository';

const CLIENT_ORGANISATION_TYPES: ClientOrganisationType[] = ['lender', 'aggregator', 'association'];

export class CreateClientOrganisationDto {
  @IsIn(CLIENT_ORGANISATION_TYPES)
  type!: ClientOrganisationType;

  @IsString()
  name!: string;
}
