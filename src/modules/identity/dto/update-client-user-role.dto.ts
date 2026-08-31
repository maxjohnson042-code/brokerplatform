import { IsIn } from 'class-validator';
import { ClientUserRole } from '../identity.repository';

const CLIENT_USER_ROLES: ClientUserRole[] = [
  'reviewer',
  'relationship_manager',
  'senior_approver',
  'compliance_officer',
  'client_admin',
];

export class UpdateClientUserRoleDto {
  @IsIn(CLIENT_USER_ROLES)
  role!: ClientUserRole;
}
