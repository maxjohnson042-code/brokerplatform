import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterBrokerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;
}
