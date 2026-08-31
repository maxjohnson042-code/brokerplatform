import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import * as repo from './brokers.repository';
import { UpdateBrokerProfileDto } from './dto/update-broker-profile.dto';
import { CreateAssociationMembershipDto } from './dto/create-association-membership.dto';
import { UpdateAssociationMembershipDto } from './dto/update-association-membership.dto';

// ONB-*: the broker profile build. Every handler requires actorType === 'broker' and
// always operates on ctx.actorId — never an id from the request, so a broker can never
// read or write another broker's profile through this controller even though the
// underlying repository functions are actor-agnostic (RLS is still the backstop, per
// Section 20.2, but this is the application-layer half of "belt and braces").
@Controller('brokers/me')
@UseGuards(JwtAuthGuard)
export class BrokersController {
  private requireBroker(ctx: AuthorizationContext): string {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    return ctx.actorId;
  }

  @Get()
  async getProfile(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    const profile = await repo.getBrokerProfile(ctx, brokerProfileId);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  @Patch()
  async updateProfile(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: UpdateBrokerProfileDto) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.updateBrokerProfile(ctx, brokerProfileId, dto as Record<string, unknown>);
    } catch (err) {
      throw this.mapProfileError(err);
    }
    return { ok: true };
  }

  @Post('attest-terms')
  async attestTerms(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    await repo.attestTerms(ctx, brokerProfileId);
    return { ok: true };
  }

  @Get('outstanding-items')
  async outstandingItems(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.getOutstandingItems(ctx, brokerProfileId);
  }

  @Post('submit')
  async submit(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.submitProfile(ctx, brokerProfileId);
    } catch (err) {
      throw this.mapProfileError(err);
    }
    return { ok: true };
  }

  @Post('associations')
  async addAssociation(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: CreateAssociationMembershipDto) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      return await repo.createAssociationMembership(ctx, brokerProfileId, dto);
    } catch (err) {
      throw this.mapProfileError(err);
    }
  }

  @Get('associations')
  async listAssociations(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.listAssociationMemberships(ctx, brokerProfileId);
  }

  @Patch('associations/:id')
  async updateAssociation(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: UpdateAssociationMembershipDto,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.updateAssociationMembership(ctx, brokerProfileId, id, dto);
    } catch (err) {
      throw this.mapProfileError(err);
    }
    return { ok: true };
  }

  @Delete('associations/:id')
  async removeAssociation(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      await repo.deleteAssociationMembership(ctx, brokerProfileId, id);
    } catch (err) {
      throw this.mapProfileError(err);
    }
    return { ok: true };
  }

  private mapProfileError(err: unknown): Error {
    if (err instanceof repo.BrokerProfileIncompleteError) return new BadRequestException({ items: err.items });
    if (err instanceof repo.BrokerProfileNotEditableError) return new ConflictException(err.message);
    if (err instanceof repo.BrokerProfileNotFoundError) return new NotFoundException(err.message);
    if (err instanceof repo.AssociationMembershipNotFoundError) return new NotFoundException(err.message);
    return err instanceof Error ? err : new Error(String(err));
  }
}
