import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { EvidenceController } from './evidence.controller';

// DOC-*: document upload, versioning, outstanding-item tracking — extends the same
// module Epic 1 scaffolded for the verification pipeline's own use of the evidence
// table (storeEvidence/logEvidenceAccess, untouched here). Imports IdentityModule for
// JwtAuthGuard (same pattern as BrokersModule/BusinessesModule). getBusiness is
// reused directly from businesses.repository.ts as a plain function — no DI
// relationship, so BusinessesModule doesn't need to be imported here.
@Module({
  imports: [IdentityModule],
  controllers: [EvidenceController],
})
export class EvidenceModule {}
