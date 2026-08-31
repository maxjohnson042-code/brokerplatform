import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

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

// All optional — a partial draft save, same as UpdateBrokerProfileDto. entityType is
// not editable here (see businesses.repository.ts's BUSINESS_UPDATABLE_FIELDS comment
// — changing it is a restructure, out of Epic 4's scope).
export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  tradingName?: string;

  @IsOptional()
  @IsString()
  abn?: string;

  @IsOptional()
  @IsString()
  acn?: string;

  @IsOptional()
  @IsBoolean()
  gstRegistered?: boolean;

  @IsOptional()
  @IsString()
  trusteeName?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  mailingAddress?: AddressDto;
}
