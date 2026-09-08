import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../identity/guards/platform-admin.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import * as repo from './rulesets.repository';
import { RulesetDefinition } from './ruleset.types';
import { CreateRulesetDraftDto } from './dto/create-ruleset-draft.dto';
import { ListRulesetsDto } from './dto/list-rulesets.dto';
import { ResolveRulesetDto } from './dto/resolve-ruleset.dto';

// Epic 9: platform_admin authors and publishes rulesets (same Thriski-ops-only
// administrative shape as PlatformAdminOrgController/W7 — this is not client
// self-service). client_user gets read-only access to their own organisation's
// rulesets via RLS, enforced identically to every prior epic's isolation tests.
//
// Static routes (resolve) declared before /:id, same ordering discipline as every
// prior controller.
@Controller('rulesets')
@UseGuards(JwtAuthGuard)
export class RulesetsController {
  @Post()
  @UseGuards(PlatformAdminGuard)
  async createDraft(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: CreateRulesetDraftDto) {
    return repo.createDraft(ctx, {
      clientOrganisationId: dto.clientOrganisationId,
      brand: dto.brand,
      role: dto.role,
      productScope: dto.productScope,
      pathway: dto.pathway,
      label: dto.label,
      // Structurally validated at publish() (ruleset-validation.ts), not here — a
      // draft is allowed to be malformed while it's still being authored.
      definition: dto.definition as unknown as RulesetDefinition,
    });
  }

  @Post(':id/publish')
  @UseGuards(PlatformAdminGuard)
  async publish(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    try {
      await repo.publish(ctx, id);
    } catch (err) {
      if (err instanceof repo.RulesetNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
    return { ok: true };
  }

  @Get('resolve')
  async resolve(@CurrentAuthContext() ctx: AuthorizationContext, @Query() query: ResolveRulesetDto) {
    const version = await repo.resolve(ctx, {
      clientOrganisationId: query.clientOrganisationId,
      brand: query.brand,
      role: query.role,
      productScope: query.productScope,
      pathway: query.pathway,
    });
    return version ?? { found: false };
  }

  @Get()
  async list(@CurrentAuthContext() ctx: AuthorizationContext, @Query() query: ListRulesetsDto) {
    return repo.listForOrganisation(ctx, query.clientOrganisationId);
  }

  @Get(':id')
  async getById(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    try {
      return await repo.getById(ctx, id);
    } catch (err) {
      if (err instanceof repo.RulesetNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}
