import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BrokersController } from './brokers.controller';

// ONB-* (profile build): imports IdentityModule for JwtAuthGuard rather than
// re-declaring auth machinery here — see identity.module.ts's exports comment.
// NotificationsModule (Epic 12) for EMAIL_SENDER — submit() dispatches on success.
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [BrokersController],
})
export class BrokersModule {}
