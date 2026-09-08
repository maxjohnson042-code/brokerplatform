import { IsString } from 'class-validator';

export class ListRulesetsDto {
  @IsString()
  clientOrganisationId!: string;
}
