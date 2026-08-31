import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { ClientUserRole } from '../identity.repository';

const CLIENT_USER_ROLES: ClientUserRole[] = [
  'reviewer',
  'relationship_manager',
  'senior_approver',
  'compliance_officer',
  'client_admin',
];

export class CreateClientUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsIn(CLIENT_USER_ROLES)
  role!: ClientUserRole;
}
