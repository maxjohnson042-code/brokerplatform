import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import * as repo from './businesses.repository';
import { BusinessesService } from './businesses.service';
import { AbnLookupResult } from './providers/abn-lookup.provider';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { AddPrincipalDto } from './dto/add-principal.dto';
import { UpdatePrincipalDto } from './dto/update-principal.dto';
import { EndAffiliationDto } from './dto/end-affiliation.dto';
import { SearchBusinessesDto } from './dto/search-businesses.dto';
import { LookupAbnDto } from './dto/lookup-abn.dto';

// BUS-001-008, BUS-013-015, ONB-014/BUS-024: broker business onboarding. Static
// routes (search, lookup, me/affiliations) are declared before the /:id routes they'd
// otherwise collide with — Nest/Express matches in declaration order at the same path
// depth.
@Controller('businesses')
@UseGuards(JwtAuthGuard)
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  private requireBroker(ctx: AuthorizationContext): string {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    return ctx.actorId;
  }

  /**
   * ONB-014/BUS-024: "looked up... and offered for one-click confirmation, not
   * typed." Standalone, so the frontend can show registry data before the broker
   * commits to creating or searching anything — never throws on a bad/unconfigured
   * lookup, always 200, so the caller can fall back to manual entry either way.
   */
  @Get('lookup')
  async lookup(@Query() query: LookupAbnDto) {
    return this.businessesService.lookupAbn(query.abn);
  }

  /**
   * BUS-024: platform matches (to request affiliation) take priority; the national
   * registry is only consulted when nothing on Thriski already matches — "one
   * authoritative record per entity" (BUS-006) means a registry hit with an existing
   * platform match should route the broker to affiliate, not to create a duplicate.
   */
  @Get('search')
  async search(@Query() query: SearchBusinessesDto) {
    const platformMatches = await repo.searchVerifiedBusinesses(query);
    let registryMatch: AbnLookupResult | null = null;
    if (query.abn && platformMatches.length === 0) {
      const outcome = await this.businessesService.lookupAbn(query.abn);
      if (outcome.status === 'found') registryMatch = outcome.result;
    }
    return { platformMatches, registryMatch };
  }

  @Post()
  async create(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: CreateBusinessDto) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.createBusiness(ctx, brokerProfileId, dto);
  }

  @Get('me/affiliations')
  async myAffiliations(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.listMyAffiliations(ctx, brokerProfileId);
  }

  @Post('me/affiliations/:affiliationId/end')
  async endMyAffiliation(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('affiliationId') affiliationId: string,
    @Body() dto: EndAffiliationDto,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.endAffiliation(ctx, brokerProfileId, affiliationId, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Get(':id')
  async getBusiness(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    this.requireBroker(ctx);
    const business = await repo.getBusiness(ctx, id);
    if (!business) throw new NotFoundException();
    return business;
  }

  @Patch(':id')
  async updateBusiness(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: UpdateBusinessDto,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.updateBusiness(ctx, brokerProfileId, id, dto as Record<string, unknown>);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Get(':id/outstanding-items')
  async outstandingItems(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    this.requireBroker(ctx);
    return repo.getOutstandingItems(ctx, id);
  }

  @Post(':id/submit')
  async submit(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.submitBusiness(ctx, brokerProfileId, id);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/affiliate')
  async affiliate(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      return await repo.requestAffiliation(ctx, brokerProfileId, id);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Get(':id/affiliations')
  async businessAffiliations(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    this.requireBroker(ctx);
    return repo.listBusinessAffiliations(ctx, id);
  }

  @Post(':id/affiliations/:affiliationId/confirm')
  async confirmAffiliation(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Param('affiliationId') affiliationId: string,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.confirmAffiliation(ctx, brokerProfileId, id, affiliationId);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/principals')
  async addPrincipal(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: AddPrincipalDto,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      return await repo.addPrincipal(ctx, brokerProfileId, id, dto);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Get(':id/principals')
  async listPrincipals(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    this.requireBroker(ctx);
    return repo.listPrincipals(ctx, id);
  }

  @Patch(':id/principals/:principalId')
  async updatePrincipal(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Param('principalId') principalId: string,
    @Body() dto: UpdatePrincipalDto,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.updatePrincipal(ctx, brokerProfileId, id, principalId, dto as Record<string, unknown>);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Delete(':id/principals/:principalId')
  async removePrincipal(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Param('principalId') principalId: string,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.removePrincipal(ctx, brokerProfileId, id, principalId);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  private mapError(err: unknown): Error {
    if (err instanceof repo.BusinessIncompleteError) return new BadRequestException({ items: err.items });
    if (err instanceof repo.BusinessNotEditableError) return new ConflictException(err.message);
    if (err instanceof repo.BusinessNotAffiliatableError) return new ConflictException(err.message);
    if (err instanceof repo.AlreadyAffiliatedError) return new ConflictException(err.message);
    if (err instanceof repo.AffiliationNotPendingError) return new ConflictException(err.message);
    if (err instanceof repo.CannotConfirmOwnAffiliationError) return new ForbiddenException(err.message);
    if (err instanceof repo.NotAffiliatedError) return new ForbiddenException(err.message);
    if (err instanceof repo.BusinessNotFoundError) return new NotFoundException(err.message);
    if (err instanceof repo.AffiliationNotFoundError) return new NotFoundException(err.message);
    if (err instanceof repo.PrincipalNotFoundError) return new NotFoundException(err.message);
    return err instanceof Error ? err : new Error(String(err));
  }
}
