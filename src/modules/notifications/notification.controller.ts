import { Body, Controller, ConflictException, Get, Patch, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import * as repo from './notification.repository';
import { NotificationCategory } from './notification-templates';
import { SetPreferenceDto } from './dto/set-preference.dto';

// NOT-005/007: a user's own notification history and preferences. Static routes only
// — everything here is scoped to the caller's own identity, never a param id.
@Controller()
@UseGuards(JwtAuthGuard)
export class NotificationController {
  private recipientOf(ctx: AuthorizationContext): { recipientType: repo.RecipientType; recipientId: string } {
    if (ctx.actorType === 'broker') return { recipientType: 'broker', recipientId: ctx.actorId };
    if (ctx.actorType === 'client_user') return { recipientType: 'client_user', recipientId: ctx.actorId };
    throw new UnauthorizedException();
  }

  @Get('notifications/me')
  async myNotifications(@CurrentAuthContext() ctx: AuthorizationContext) {
    const { recipientType, recipientId } = this.recipientOf(ctx);
    return repo.listMine(ctx, recipientType, recipientId);
  }

  @Get('notification-preferences')
  async getPreferences(@CurrentAuthContext() ctx: AuthorizationContext) {
    const { recipientType, recipientId } = this.recipientOf(ctx);
    return repo.getPreferences(ctx, recipientType, recipientId);
  }

  @Patch('notification-preferences')
  async setPreference(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: SetPreferenceDto) {
    const { recipientType, recipientId } = this.recipientOf(ctx);
    try {
      await repo.setPreference(ctx, recipientType, recipientId, dto.category as NotificationCategory, dto.enabled);
    } catch (err) {
      if (err instanceof repo.MandatoryCategoryError) throw new ConflictException(err.message);
      throw err;
    }
    return { ok: true };
  }
}
