import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const CLASSIFICATIONS = ['new_broker_introducer', 'new_referrer_introducer', 'transfer', 'add_on'];
const LICENCE_HOLDER_TYPES = ['aggregator_organisation', 'broking_business', 'third_party'];

export class RequestAccreditationDto {
  @IsString()
  lenderClientOrganisationId!: string;

  @IsString()
  brokerBusinessId!: string;

  @IsIn(CLASSIFICATIONS)
  classification!: string;

  @IsString()
  @MinLength(1)
  brand!: string;

  @IsString()
  @MinLength(1)
  role!: string;

  @IsString()
  @MinLength(1)
  productScope!: string;

  @IsIn(LICENCE_HOLDER_TYPES)
  licenceHolderType!: string;

  @IsOptional()
  @IsString()
  licenceHolderClientOrganisationId?: string;

  @IsOptional()
  @IsString()
  licenceHolderBrokerBusinessId?: string;

  @IsOptional()
  @IsString()
  licenceHolderName?: string;

  @IsOptional()
  @IsBoolean()
  isCorporateCreditRepresentative?: boolean;
}
