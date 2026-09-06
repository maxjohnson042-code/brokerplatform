import { IsString } from 'class-validator';

export class LookupAbnDto {
  @IsString()
  abn!: string;
}
