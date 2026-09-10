import { Controller, ForbiddenException, Get, NotFoundException, Param, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import * as repo from './brokers.repository';
import { listAffiliationsForBroker } from '../businesses/businesses.repository';
import { listForBrokerAndLender } from '../accreditation/accreditation.repository';
import { listCurrentDocuments } from '../evidence/evidence.repository';
import { hasActiveRelationshipWithBroker } from '../relationships/relationships.repository';

/**
 * The lender's-point-of-view read surface onto a related broker — a distinct prefix
 * from brokers/me (the broker's own view) so a :brokerId route can never shadow those
 * static routes. Every handler re-checks the caller actually holds an active
 * lender_panel/aggregator_membership relationship to the target broker BEFORE calling
 * into the underlying (actor-agnostic) repository functions — the app-layer belt;
 * RLS (migration 0021's has_active_relationship, already covering every table read
 * here) is the brace. Nothing below needed a new RLS policy: the gap this controller
 * closes is missing routes, not missing visibility.
 */
@Controller('client/brokers')
@UseGuards(JwtAuthGuard)
export class ClientBrokerViewController {
  private requireClientUser(ctx: AuthorizationContext): { clientOrganisationId: string } {
    if (ctx.actorType !== 'client_user') throw new UnauthorizedException();
    return { clientOrganisationId: ctx.clientOrganisationId };
  }

  private async assertActiveRelationship(ctx: AuthorizationContext, brokerId: string): Promise<void> {
    const active = await hasActiveRelationshipWithBroker(ctx, brokerId);
    if (!active) throw new ForbiddenException('no active relationship with this broker');
  }

  @Get(':brokerId')
  async getProfile(@CurrentAuthContext() ctx: AuthorizationContext, @Param('brokerId') brokerId: string) {
    this.requireClientUser(ctx);
    await this.assertActiveRelationship(ctx, brokerId);
    const profile = await repo.getBrokerProfile(ctx, brokerId);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  @Get(':brokerId/associations')
  async listAssociations(@CurrentAuthContext() ctx: AuthorizationContext, @Param('brokerId') brokerId: string) {
    this.requireClientUser(ctx);
    await this.assertActiveRelationship(ctx, brokerId);
    return repo.listAssociationMemberships(ctx, brokerId);
  }

  @Get(':brokerId/documents')
  async listDocuments(@CurrentAuthContext() ctx: AuthorizationContext, @Param('brokerId') brokerId: string) {
    this.requireClientUser(ctx);
    await this.assertActiveRelationship(ctx, brokerId);
    return listCurrentDocuments(ctx, 'broker_profile', brokerId);
  }

  @Get(':brokerId/businesses')
  async listBusinesses(@CurrentAuthContext() ctx: AuthorizationContext, @Param('brokerId') brokerId: string) {
    this.requireClientUser(ctx);
    await this.assertActiveRelationship(ctx, brokerId);
    return listAffiliationsForBroker(ctx, brokerId);
  }

  @Get(':brokerId/accreditations')
  async listAccreditations(@CurrentAuthContext() ctx: AuthorizationContext, @Param('brokerId') brokerId: string) {
    const { clientOrganisationId } = this.requireClientUser(ctx);
    await this.assertActiveRelationship(ctx, brokerId);
    return listForBrokerAndLender(ctx, clientOrganisationId, brokerId);
  }
}
