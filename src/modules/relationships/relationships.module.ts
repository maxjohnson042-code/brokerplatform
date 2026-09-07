import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RelationshipsController } from './relationships.controller';

// REL-*: both relationship directions, status view, revoke/end. Imports
// IdentityModule for JwtAuthGuard, same pattern every controller-bearing module has
// used since Epic 3.
@Module({
  imports: [IdentityModule],
  controllers: [RelationshipsController],
})
export class RelationshipsModule {}
