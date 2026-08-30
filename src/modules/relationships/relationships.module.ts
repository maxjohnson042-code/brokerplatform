import { Module } from '@nestjs/common';

// Client-initiated invitations (REL-003/004), revocation (REL-006/007) and the
// visibility-resolution service extraction noted in migration 0007's closing comment
// are Epic 8. requestRelationship() here is enough to prove the tenancy boundary in
// Epic 1's demo script.
@Module({})
export class RelationshipsModule {}
