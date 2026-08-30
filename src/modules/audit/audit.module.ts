import { Module } from '@nestjs/common';

// No providers yet — audit is consumed as plain functions (recordAuditEvent) by other
// modules' repositories within their own transactions, per Section 20.5. This module
// exists so `audit` shows up as a first-class boundary in src/app.module.ts and so a
// future audit-query API (AUD-002, AUD-008: evidence packs, regulator exports) has an
// obvious home.
@Module({})
export class AuditModule {}
