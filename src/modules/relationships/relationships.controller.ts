import {
  Body,
  Controller,
  ConflictException,
  Get,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import * as repo from './relationships.repository';
import { RequestRelationshipDto } from './dto/request-relationship.dto';
import { InviteBrokerDto } from './dto/invite-broker.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { RevokeRelationshipDto } from './dto/revoke-relationship.dto';
import { EndRelationshipDto } from './dto/end-relationship.dto';

// REL-001-007/010: both relationship directions (broker self-service and
// client-initiated invitation), a single status view per actor, and revoke/end.
// Static routes (me, invitations, organisation) declared before the /:id routes they'd
// otherwise collide with, same ordering discipline as every prior controller.
@Controller('relationships')
@UseGuards(JwtAuthGuard)
export class RelationshipsController {
  private requireBroker(ctx: AuthorizationContext): string {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    return ctx.actorId;
  }

  private requireClientUser(ctx: AuthorizationContext): { actorId: string; clientOrganisationId: string } {
    if (ctx.actorType !== 'client_user') throw new UnauthorizedException();
    return { actorId: ctx.actorId, clientOrganisationId: ctx.clientOrganisationId };
  }

  @Post()
  async request(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: RequestRelationshipDto) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.requestRelationship(ctx, { brokerProfileId, ...dto });
  }

  @Get('me')
  async myRelationships(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.listMyRelationships(ctx, brokerProfileId);
  }

  @Post('invitations')
  async invite(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: InviteBrokerDto) {
    const { clientOrganisationId } = this.requireClientUser(ctx);
    try {
      return await repo.inviteBroker(ctx, { clientOrganisationId, ...dto });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Get('organisation')
  async organisationRelationships(@CurrentAuthContext() ctx: AuthorizationContext) {
    const { clientOrganisationId } = this.requireClientUser(ctx);
    return repo.listOrganisationRelationships(ctx, clientOrganisationId);
  }

  @Post(':id/accept')
  async accept(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: AcceptInvitationDto,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.acceptInvitation(ctx, brokerProfileId, id, dto.consentVersion);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/decline')
  async decline(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.declineInvitation(ctx, brokerProfileId, id);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/revoke')
  async revoke(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: RevokeRelationshipDto,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.revokeRelationship(ctx, brokerProfileId, id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/end')
  async end(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string, @Body() dto: EndRelationshipDto) {
    const { actorId, clientOrganisationId } = this.requireClientUser(ctx);
    try {
      await repo.endRelationship(ctx, actorId, clientOrganisationId, id, dto.reason);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  private mapError(err: unknown): Error {
    if (err instanceof repo.RelationshipNotFoundError) return new NotFoundException(err.message);
    if (err instanceof repo.BrokerNotFoundError) return new NotFoundException(err.message);
    if (err instanceof repo.InvalidRelationshipTransitionError) return new ConflictException(err.message);
    return err instanceof Error ? err : new Error(String(err));
  }
}
