import { Module } from '@nestjs/common';

// NOT-*: broker and client notifications on submission, decisions, training issue.
// Epic 12. Templating/delivery provider is an "unremarkable" integration per
// Section 24 — no need to over-design this ahead of the epic that needs it.
@Module({})
export class NotificationsModule {}
