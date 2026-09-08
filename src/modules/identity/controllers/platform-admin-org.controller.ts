import { Body, Controller, Param, Patch, Post, UseGuards, ConflictException } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { CurrentAuthContext } from '../decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../../db/authorization-context';
import * as repo from '../identity.repository';
import { CreateClientOrganisationDto } from '../dto/create-client-organisation.dto';
import { SetProductScopesDto } from '../dto/set-product-scopes.dto';
import { SetBrandingDto } from '../dto/set-branding.dto';
import { CreateClientUserDto } from '../dto/create-client-user.dto';

// W7: the internal tool Thriski operations uses to stand up the one Release-1 lender —
// create, verify, configure (product scopes/branding — ruleset assignment is
// RulesetsController's job as of Epic 9), then provision its first client_admin so
// the org can self-serve via ClientUserAdminController from there on. Deliberately
// not a client-facing feature (Section 6.7: "Administrative, performed by Thriski
// operations").
@Controller('platform-admin/organisations')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformAdminOrgController {
  @Post()
  async create(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: CreateClientOrganisationDto) {
    return repo.createClientOrganisation(ctx, dto);
  }

  @Post(':id/verify')
  async verify(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    await repo.verifyClientOrganisation(ctx, id);
    return { ok: true };
  }

  @Patch(':id/product-scopes')
  async setProductScopes(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: SetProductScopesDto,
  ) {
    await repo.updateClientOrganisationSetting(ctx, id, 'productScopes', dto.productScopes);
    return { ok: true };
  }

  @Patch(':id/branding')
  async setBranding(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string, @Body() dto: SetBrandingDto) {
    await repo.updateClientOrganisationSetting(ctx, id, 'branding', dto);
    return { ok: true };
  }

  @Post(':id/users')
  async provisionFirstAdmin(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: CreateClientUserDto,
  ) {
    try {
      return await repo.createClientUser(ctx, { clientOrganisationId: id, ...dto });
    } catch (err) {
      if (err instanceof repo.ClientUserEmailTakenError) throw new ConflictException(err.message);
      throw err;
    }
  }
}
