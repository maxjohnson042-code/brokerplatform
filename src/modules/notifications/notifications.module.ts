import { forwardRef, Module } from '@nestjs/common';
import { ConsoleEmailSender } from './email-sender';
import { IdentityModule } from '../identity/identity.module';
import { NotificationController } from './notification.controller';

// NOT-*: broker and client notifications on submission, decisions, training issue.
// Epic 12. Templating/delivery provider is an "unremarkable" integration per
// Section 24 — no need to over-design this ahead of the epic that needs it.
//
// The one exception: AUTH-005 (password reset via email) needs *some* sender now, in
// Epic 2, well before Epic 12. EMAIL_SENDER below is intentionally just the
// console-fallback — swap for a real provider-backed EmailSender behind the same token
// when Epic 12 (or production) needs one, without identity module callers changing.
export const EMAIL_SENDER = 'EMAIL_SENDER';

@Module({
  imports: [forwardRef(() => IdentityModule)],
  controllers: [NotificationController],
  providers: [{ provide: EMAIL_SENDER, useClass: ConsoleEmailSender }],
  exports: [EMAIL_SENDER],
})
export class NotificationsModule {}
