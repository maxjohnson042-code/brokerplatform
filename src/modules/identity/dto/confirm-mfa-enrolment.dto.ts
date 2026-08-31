import { IsString } from 'class-validator';

export class ConfirmMfaEnrolmentDto {
  @IsString()
  code!: string;
}
