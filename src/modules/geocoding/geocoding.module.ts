import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { GeocodingController } from './geocoding.controller';

@Module({
  imports: [IdentityModule],
  controllers: [GeocodingController],
})
export class GeocodingModule {}
