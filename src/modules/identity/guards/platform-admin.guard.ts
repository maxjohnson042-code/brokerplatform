import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthorizationContext } from '../../../db/authorization-context';

// Runs after JwtAuthGuard. There's no role concept for platform_admin (unlike
// client_user) — actorType itself is the authorization check, per W7 (Section 6.7:
// only Thriski operations touches this tool).
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx: AuthorizationContext = context.switchToHttp().getRequest().authContext;
    if (ctx?.actorType !== 'platform_admin') throw new ForbiddenException('platform administrator access only');
    return true;
  }
}
