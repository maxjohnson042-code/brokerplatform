import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { BrokersController } from './brokers.controller';

// ONB-* (profile build): imports IdentityModule for JwtAuthGuard rather than
// re-declaring auth machinery here — see identity.module.ts's exports comment.
@Module({
  imports: [IdentityModule],
  controllers: [BrokersController],
})
export class BrokersModule {}
