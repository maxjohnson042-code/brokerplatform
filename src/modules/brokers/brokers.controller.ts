import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { defaultImageStorage, extensionFor } from '../media/image-storage';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import { EMAIL_SENDER } from '../notifications/notifications.module';
import { EmailSender } from '../notifications/email-sender';
import { markSent } from '../notifications/notification.repository';
import * as repo from './brokers.repository';
import { UpdateBrokerProfileDto } from './dto/update-broker-profile.dto';
import { CreateAssociationMembershipDto } from './dto/create-association-membership.dto';
import { UpdateAssociationMembershipDto } from './dto/update-association-membership.dto';
import { ReconstructionQueryDto } from './dto/reconstruction-query.dto';

// ONB-*: the broker profile build. Every handler requires actorType === 'broker' and
// always operates on ctx.actorId — never an id from the request, so a broker can never
// read or write another broker's profile through this controller even though the
// underlying repository functions are actor-agnostic (RLS is still the backstop, per
// Section 20.2, but this is the application-layer half of "belt and braces").
@Controller('brokers/me')
@UseGuards(JwtAuthGuard)
export class BrokersController {
  constructor(@Inject(EMAIL_SENDER) private readonly email: EmailSender) {}

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

  @Post('photo')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
  }))
  async uploadPhoto(@CurrentAuthContext() ctx: AuthorizationContext, @UploadedFile() file?: Express.Multer.File) {
    const brokerProfileId = this.requireBroker(ctx);
    if (!file) throw new BadRequestException('file is required (JPEG, PNG or WEBP, up to 5MB)');
    const key = await defaultImageStorage.put(file.buffer, extensionFor(file.mimetype));
    const photoUrl = `/media/${key}`;
    await repo.updateMyPhoto(ctx, brokerProfileId, photoUrl);
    return { photoUrl };
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
      const { notificationId, recipientEmail, shouldSend, subject, body } = await repo.submitProfile(ctx, brokerProfileId);
      if (shouldSend) {
        await this.email.send(recipientEmail, subject, body);
        await markSent(notificationId);
      }
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

  // Epic 13 — PRF-003/AUD-003/AUD-005.
  @Get('outstanding-summary')
  async outstandingSummary(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.getOutstandingSummary(ctx, brokerProfileId);
  }

  @Get('access-history')
  async accessHistory(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.listAccessHistory(ctx, brokerProfileId);
  }

  @Get('reconstruction')
  async reconstruction(@CurrentAuthContext() ctx: AuthorizationContext, @Query() query: ReconstructionQueryDto) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.reconstructAsOf(ctx, brokerProfileId, new Date(query.asOf));
  }

  private mapProfileError(err: unknown): Error {
    if (err instanceof repo.BrokerProfileIncompleteError) return new BadRequestException({ items: err.items });
    if (err instanceof repo.BrokerProfileNotEditableError) return new ConflictException(err.message);
    if (err instanceof repo.BrokerProfileNotFoundError) return new NotFoundException(err.message);
    if (err instanceof repo.AssociationMembershipNotFoundError) return new NotFoundException(err.message);
    return err instanceof Error ? err : new Error(String(err));
  }
}
