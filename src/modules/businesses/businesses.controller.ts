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
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { AddPrincipalDto } from './dto/add-principal.dto';
import { UpdatePrincipalDto } from './dto/update-principal.dto';
import { EndAffiliationDto } from './dto/end-affiliation.dto';
import { SearchBusinessesDto } from './dto/search-businesses.dto';

// BUS-001-008, BUS-013-015: broker business onboarding. Static routes (search,
// me/affiliations) are declared before the /: id routes they'd otherwise collide with
// — Nest/Express matches in declaration order at the same path depth.
@Controller('businesses')
@UseGuards(JwtAuthGuard)
export class BusinessesController {
  private requireBroker(ctx: AuthorizationContext): string {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    return ctx.actorId;
  }

  @Get('search')
  async search(@Query() query: SearchBusinessesDto) {
    return repo.searchVerifiedBusinesses(query);
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
