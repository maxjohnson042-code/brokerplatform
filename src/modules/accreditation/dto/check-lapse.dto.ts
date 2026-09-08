import { IsString } from 'class-validator';

export class CheckLapseDto {
  @IsString()
  lenderClientOrganisationId!: string;
}
