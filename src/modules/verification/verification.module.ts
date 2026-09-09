import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VerificationController } from './verification.controller';

// Epic 6: IDV-* (Sumsub KYC + a mocked KYB adapter behind the same interface). The
// synchronous submit/poll shape here (rather than Section 21's SKIP LOCKED job queue)
// is deliberately Release-1-scoped — Sumsub's own webhook already gives async
// delivery for KYC, and the mock KYB adapter resolves synchronously by construction,
// so there's no queue-worthy backlog of pending checks yet. Revisit if/when a second
// real, slow-polling provider actually needs one.
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [VerificationController],
})
export class VerificationModule {}
