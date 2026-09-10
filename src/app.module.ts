import { Module } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';

import { IdentityModule } from './modules/identity/identity.module';
import { BrokersModule } from './modules/brokers/brokers.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { RelationshipsModule } from './modules/relationships/relationships.module';
import { AccreditationModule } from './modules/accreditation/accreditation.module';
import { VerificationModule } from './modules/verification/verification.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { MediaModule } from './modules/media/media.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { ListsModule } from './modules/lists/lists.module';
import { RulesetsModule } from './modules/rulesets/rulesets.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MeteringModule } from './modules/metering/metering.module';
import { AuditModule } from './modules/audit/audit.module';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

// One module list, matching Section 19 verbatim. This is the whole point of the
// modular-monolith shape: every module below is a folder under src/modules with its
// own tables and its own interface, all deployed as this one application. Splitting
// any of these into a separate service is a decision for later, made against a
// demonstrated scaling or team-autonomy problem — not a default.
@Module({
  imports: [
    IdentityModule,
    BrokersModule,
    BusinessesModule,
    RelationshipsModule,
    AccreditationModule,
    VerificationModule,
    EvidenceModule,
    MediaModule,
    GeocodingModule,
    MonitoringModule,
    ListsModule,
    RulesetsModule,
    NotificationsModule,
    MeteringModule,
    AuditModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
