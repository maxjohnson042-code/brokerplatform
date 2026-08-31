import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityType } from '../businesses.repository';

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

const ENTITY_TYPES = ['company', 'sole_trader', 'partnership', 'trust'];

// entityType is the one required field — everything else is optional at creation
// (draft save, ONB-008-equivalent for businesses) and enforced only at submit time by
// businesses.repository.ts's getOutstandingItems.
export class CreateBusinessDto {
  @IsIn(ENTITY_TYPES)
  entityType!: EntityType;

  @IsOptional()
  @IsString()
  legalName?: string; // sole traders may omit — derived from the broker's own name

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
