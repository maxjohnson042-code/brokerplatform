import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { IdentityService } from './identity.service';
import { BrokerAuthController } from './controllers/broker-auth.controller';
import { ClientAuthController } from './controllers/client-auth.controller';
import { ClientUserAdminController } from './controllers/client-user-admin.controller';
import { PlatformAdminAuthController } from './controllers/platform-admin-auth.controller';
import { PlatformAdminOrgController } from './controllers/platform-admin-org.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { MfaPendingGuard } from './guards/mfa-pending.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

// Epic 2: the first real HTTP surface in the codebase. Secrets are passed explicitly
// on every sign/verify call in identity.service.ts rather than configured once here —
// JwtModule.register({}) with no default secret keeps that the single source of truth
// (see env.ts) instead of duplicating it into module config too.
@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [
    BrokerAuthController,
    ClientAuthController,
    ClientUserAdminController,
    PlatformAdminAuthController,
    PlatformAdminOrgController,
  ],
  providers: [IdentityService, JwtAuthGuard, RolesGuard, MfaPendingGuard, PlatformAdminGuard],
  // JwtAuthGuard exported so other modules (BrokersModule, and later Epic 4+) can
  // @UseGuards(JwtAuthGuard) on their own controllers without re-declaring it —
  // CurrentAuthContext needs no export, it's a plain factory function, not a provider.
  exports: [IdentityService, JwtAuthGuard],
})
export class IdentityModule {}
