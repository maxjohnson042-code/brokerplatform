import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BrokersController } from './brokers.controller';
import { ClientBrokerViewController } from './client-broker-view.controller';

// ONB-* (profile build): imports IdentityModule for JwtAuthGuard rather than
// re-declaring auth machinery here — see identity.module.ts's exports comment.
// NotificationsModule (Epic 12) for EMAIL_SENDER — submit() dispatches on success.
// ClientBrokerViewController (the lender's-point-of-view broker read surface) needs
// only JwtAuthGuard — its other repository imports (businesses/accreditation/evidence)
// are plain function imports, not services, same cross-module pattern
// brokers.repository.ts itself already uses.
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [BrokersController, ClientBrokerViewController],
})
export class BrokersModule {}
