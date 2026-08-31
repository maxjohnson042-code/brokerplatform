import { Body, Controller, Get, Param, Patch, Post, UseGuards, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../guards/roles.decorator';
import { CurrentAuthContext } from '../decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../../db/authorization-context';
import * as repo from '../identity.repository';
import { CreateClientUserDto } from '../dto/create-client-user.dto';
import { UpdateClientUserRoleDto } from '../dto/update-client-user-role.dto';

// AUTH-008: provisioning, roles and deactivation, scoped to the caller's own
// organisation. ctx.clientOrganisationId (from the verified access token) is what
// scopes every call below — never a value from the request body/path, so a client_admin
// can never act on another organisation's users even if they guess an id. Migration
// 0013's client_users RLS policies are the database-layer backstop for the same rule.
@Controller('client-admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client_admin')
export class ClientUserAdminController {
  @Post()
  async create(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: CreateClientUserDto) {
    if (ctx.actorType !== 'client_user') throw new NotFoundException();
    try {
      return await repo.createClientUser(ctx, { clientOrganisationId: ctx.clientOrganisationId, ...dto });
    } catch (err) {
      if (err instanceof repo.ClientUserEmailTakenError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Get()
  async list(@CurrentAuthContext() ctx: AuthorizationContext) {
    if (ctx.actorType !== 'client_user') throw new NotFoundException();
    return repo.listClientUsers(ctx, ctx.clientOrganisationId);
  }

  @Patch(':id/role')
  async updateRole(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: UpdateClientUserRoleDto,
  ) {
    if (ctx.actorType !== 'client_user') throw new NotFoundException();
    try {
      await repo.updateClientUserRole(ctx, ctx.clientOrganisationId, id, dto.role);
    } catch (err) {
      if (err instanceof repo.ClientUserNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
    return { ok: true };
  }

  @Post(':id/deactivate')
  async deactivate(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    return this.setActive(ctx, id, false);
  }

  @Post(':id/reactivate')
  async reactivate(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    return this.setActive(ctx, id, true);
  }

  private async setActive(ctx: AuthorizationContext, id: string, isActive: boolean) {
    if (ctx.actorType !== 'client_user') throw new NotFoundException();
    try {
      await repo.setClientUserActive(ctx, ctx.clientOrganisationId, id, isActive);
    } catch (err) {
      if (err instanceof repo.ClientUserNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
    return { ok: true };
  }
}
