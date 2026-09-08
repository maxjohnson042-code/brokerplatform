import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccreditationController } from './accreditation.controller';

// ACR-*/REV-*: the four-party accreditation record, chain validation, and the lender
// review workbench. Epic 10 in the Release 1 backlog — deliberately not started until
// relationships (Epic 8) and the ruleset engine (Epic 9) exist, since accreditation
// depends on both.
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [AccreditationController],
})
export class AccreditationModule {}
