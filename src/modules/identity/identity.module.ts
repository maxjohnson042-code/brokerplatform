import { Module } from '@nestjs/common';

// HTTP controllers (registration, login, session issuance) are next in Epic 2 — this
// scaffold ships the repository functions plus the password-hashing primitives, since
// the schema and the AuthorizationContext boundary are what Epic 1 needs proven, not
// a finished auth flow with token refresh, MFA enrolment (AUTH-006/007), etc.
@Module({})
export class IdentityModule {}
