import { Module } from '@nestjs/common';

// Release 3 (black list) and the governance-gated Release 4 (grey list) — Section 26.
// Empty on purpose; see monitoring.module.ts's comment, same reasoning applies here.
@Module({})
export class ListsModule {}
