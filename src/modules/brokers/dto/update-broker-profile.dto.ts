import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class AddressDto {
  @IsString()
  line1!: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  city!: string;

  @IsString()
  postcode!: string;

  @IsString()
  state!: string;
}

const GENDERS = ['male', 'female', 'other'];
const LICENCE_TYPES = ['own_credit_licence', 'credit_representative', 'exempt'];

// All fields optional — this is a draft partial save (ONB-008), not a full-record PUT.
// Which fields are actually required before submission is computed by
// brokers.repository.ts's getOutstandingItems, not enforced here.
export class UpdateBrokerProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  otherNames?: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  postalAddress?: AddressDto;

  @IsOptional()
  @IsString()
  rightToWorkStatus?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  experienceYears?: number;

  @IsOptional()
  @IsIn(LICENCE_TYPES)
  licenceTypeHeld?: string;

  @IsOptional()
  @IsString()
  creditLicenceNumber?: string;

  @IsOptional()
  @IsString()
  creditRepresentativeNumber?: string;

  @IsOptional()
  @IsString()
  licensingEntityName?: string;

  @IsOptional()
  @IsString()
  licensingEntityNumber?: string;
}
