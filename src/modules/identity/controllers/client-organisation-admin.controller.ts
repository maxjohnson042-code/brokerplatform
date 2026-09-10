import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../guards/roles.decorator';
import { CurrentAuthContext } from '../decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../../db/authorization-context';
import * as repo from '../identity.repository';
import { SetBrandingDto } from '../dto/set-branding.dto';
import { defaultImageStorage, extensionFor } from '../../media/image-storage';

// UI polish: a client_admin self-serving their own organisation's branding (logo),
// scoped to ctx.clientOrganisationId the same way ClientUserAdminController scopes
// user management — never an id from the request. Reuses
// updateClientOrganisationSetting (identity.repository.ts), the same write path
// PlatformAdminOrgController's branding endpoint already uses.
//
// GET is deliberately NOT @Roles-gated (moved off the class level to just the two
// mutation handlers below) — any authenticated client_user needs to read their own
// org's name/logo (e.g. the lender dashboard header), not just a client_admin. Still
// scoped to the caller's own org via requireClientOrgId; read-only, no new exposure.
@Controller('client-admin/organisation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientOrganisationAdminController {
  private requireClientOrgId(ctx: AuthorizationContext): string {
    if (ctx.actorType !== 'client_user') throw new NotFoundException();
    return ctx.clientOrganisationId;
  }

  @Get()
  async get(@CurrentAuthContext() ctx: AuthorizationContext) {
    const orgId = this.requireClientOrgId(ctx);
    const org = await repo.getMyOrganisation(ctx, orgId);
    if (!org) throw new NotFoundException();
    return org;
  }

  @Patch('branding')
  @Roles('client_admin')
  async setBranding(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: SetBrandingDto) {
    const orgId = this.requireClientOrgId(ctx);
    await repo.updateClientOrganisationSetting(ctx, orgId, 'branding', dto);
    return { ok: true };
  }

  @Post('logo')
  @Roles('client_admin')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
  }))
  async uploadLogo(@CurrentAuthContext() ctx: AuthorizationContext, @UploadedFile() file?: Express.Multer.File) {
    const orgId = this.requireClientOrgId(ctx);
    if (!file) throw new BadRequestException('file is required (JPEG, PNG or WEBP, up to 5MB)');
    const key = await defaultImageStorage.put(file.buffer, extensionFor(file.mimetype));
    const logoUrl = `/media/${key}`;
    const org = await repo.getMyOrganisation(ctx, orgId);
    await repo.updateClientOrganisationSetting(ctx, orgId, 'branding', {
      ...org?.branding,
      logoUrl,
    });
    return { logoUrl };
  }
}
