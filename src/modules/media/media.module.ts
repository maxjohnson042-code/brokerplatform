import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MediaController } from './media.controller';

// Mutable image upload/serve (profile photos, org logos) — see image-storage.ts's
// comment for why this is separate from EvidenceModule. Imports IdentityModule for
// JwtAuthGuard (same pattern as every other module's upload endpoint).
@Module({
  imports: [IdentityModule],
  controllers: [MediaController],
})
export class MediaModule {}
