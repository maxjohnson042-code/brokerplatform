import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { geocodeAddress } from './geocoding.provider';

@Controller('geocode')
@UseGuards(JwtAuthGuard)
export class GeocodingController {
  @Get()
  async geocode(@Query('address') address: string) {
    return geocodeAddress(address ?? '');
  }
}
