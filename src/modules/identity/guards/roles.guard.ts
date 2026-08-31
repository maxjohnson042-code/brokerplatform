import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { ClientUserRole } from '../identity.repository';

/**
 * Runs after JwtAuthGuard — reads the role JwtAuthGuard attached to the request from
 * the access token's `role` claim (client_users only; brokers/platform_admins have no
 * role concept and never pass @Roles-guarded routes).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride, not get(..., context.getHandler()) alone: @Roles() on
    // ClientUserAdminController is applied at the class level, not per-method, and
    // get() only reads handler-level metadata — this was silently letting every role
    // through until caught by client-mfa.spec.ts's forbidden-role test.
    const required = this.reflector.getAllAndOverride<ClientUserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const role: ClientUserRole | undefined = request.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(`requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}
