import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class RequestInformationDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemisedReasons!: string[];
}
