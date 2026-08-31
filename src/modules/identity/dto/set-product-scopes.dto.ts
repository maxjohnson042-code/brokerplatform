import { IsArray, IsString } from 'class-validator';

export class SetProductScopesDto {
  @IsArray()
  @IsString({ each: true })
  productScopes!: string[];
}
