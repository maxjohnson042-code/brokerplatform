import { SetMetadata } from '@nestjs/common';
import { ClientUserRole } from '../identity.repository';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ClientUserRole[]) => SetMetadata(ROLES_KEY, roles);
