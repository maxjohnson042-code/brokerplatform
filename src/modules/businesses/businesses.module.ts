import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { BusinessesController } from './businesses.controller';

// BUS-*: business onboarding, principal capture, affiliation confirmation, the
// sole-trader inline journey. Imports IdentityModule for JwtAuthGuard, same pattern
// BrokersModule already established in Epic 3.
@Module({
  imports: [IdentityModule],
  controllers: [BusinessesController],
})
export class BusinessesModule {}
