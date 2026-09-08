import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

// BUS-*: business onboarding, principal capture, affiliation confirmation, the
// sole-trader inline journey. Imports IdentityModule for JwtAuthGuard, same pattern
// BrokersModule already established in Epic 3. NotificationsModule (Epic 12) for
// EMAIL_SENDER — submit() dispatches on success.
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
