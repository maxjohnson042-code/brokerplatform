import {
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import { EMAIL_SENDER } from '../notifications/notifications.module';
import { EmailSender } from '../notifications/email-sender';
import { markSent } from '../notifications/notification.repository';
import * as repo from './accreditation.repository';
import * as trainingRepo from './training.repository';
import { RequestAccreditationDto } from './dto/request-accreditation.dto';
import { QueueFiltersDto } from './dto/queue-filters.dto';
import { RequestInformationDto } from './dto/request-information.dto';
import { OptionalRationaleDto, DeclineDto, InterviewOutcomeDto } from './dto/decision.dto';
import { ConfirmTrainingDto } from './dto/confirm-training.dto';
import { CheckLapseDto } from './dto/check-lapse.dto';

// ACR-*/REV-*: the four-party accreditation record and the lender review workbench.
// Static routes (me, queue) declared before /:id, same ordering discipline as every
// prior controller.
@Controller('accreditations')
@UseGuards(JwtAuthGuard)
export class AccreditationController {
  constructor(@Inject(EMAIL_SENDER) private readonly email: EmailSender) {}

  private requireBroker(ctx: AuthorizationContext): string {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    return ctx.actorId;
  }

  private requireClientUser(ctx: AuthorizationContext): { actorId: string; clientOrganisationId: string } {
    if (ctx.actorType !== 'client_user') throw new UnauthorizedException();
    return { actorId: ctx.actorId, clientOrganisationId: ctx.clientOrganisationId };
  }

  @Post()
  async request(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: RequestAccreditationDto) {
    const brokerProfileId = this.requireBroker(ctx);
    try {
      // dto's classification/licenceHolderType are validated by @IsIn against the
      // same vocabularies the repository's narrower types encode — safe to widen here.
      const { id, queueNotifications } = await repo.requestAccreditation(ctx, {
        brokerProfileId,
        ...dto,
        classification: dto.classification as repo.AccreditationClassification,
        licenceHolderType: dto.licenceHolderType as repo.LicenceHolderType,
      });
      // NOT-002: every active client_user of the lender org gets a queue-entry email —
      // best-effort, post-commit, same as every other Epic 12 dispatch.
      for (const n of queueNotifications) {
        if (n.shouldSend) {
          await this.email.send(n.recipientEmail, n.subject, n.body);
          await markSent(n.id);
        }
      }
      return { id };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Get('me')
  async myAccreditations(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.listMine(ctx, brokerProfileId);
  }

  @Get('queue')
  async queue(@CurrentAuthContext() ctx: AuthorizationContext, @Query() query: QueueFiltersDto) {
    this.requireClientUser(ctx);
    const { lenderClientOrganisationId, status, classification, productScope } = query;
    return repo.listQueue(ctx, lenderClientOrganisationId, {
      status: status as repo.AccreditationStatus | undefined,
      classification: classification as repo.AccreditationClassification | undefined,
      productScope,
    });
  }

  // TRN-008: static route, declared before /:id per the same ordering discipline as
  // every prior controller.
  @Post('check-lapse')
  async checkLapse(@CurrentAuthContext() ctx: AuthorizationContext, @Query() query: CheckLapseDto) {
    this.requireClientUser(ctx);
    const lapsedIds = await trainingRepo.checkTrainingDeadlines(ctx, query.lenderClientOrganisationId);
    return { lapsedIds };
  }

  @Get(':id')
  async getById(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    try {
      return await repo.getFullContext(ctx, id);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Get(':id/outstanding-items')
  async outstandingItems(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    try {
      return await repo.getOutstandingItems(ctx, id);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Post(':id/request-information')
  async requestInformation(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: RequestInformationDto,
  ) {
    this.requireClientUser(ctx);
    try {
      const { notificationId, recipientEmail, shouldSend, subject, body } = await repo.requestMoreInformation(ctx, id, dto.itemisedReasons);
      if (shouldSend) {
        await this.email.send(recipientEmail, subject, body);
        await markSent(notificationId);
      }
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/escalate')
  async escalate(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string, @Body() dto: OptionalRationaleDto) {
    this.requireClientUser(ctx);
    try {
      await repo.escalate(ctx, id, dto.rationale);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/approve')
  async approve(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string, @Body() dto: OptionalRationaleDto) {
    this.requireClientUser(ctx);
    try {
      const { notificationId, recipientEmail, shouldSend, subject, body } = await repo.approve(ctx, id, dto.rationale);
      if (shouldSend) {
        await this.email.send(recipientEmail, subject, body);
        await markSent(notificationId);
      }
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/decline')
  async decline(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string, @Body() dto: DeclineDto) {
    this.requireClientUser(ctx);
    try {
      const { notificationId, recipientEmail, shouldSend, subject, body } = await repo.decline(ctx, id, dto.rationale);
      if (shouldSend) {
        await this.email.send(recipientEmail, subject, body);
        await markSent(notificationId);
      }
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/interview')
  async interview(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string, @Body() dto: InterviewOutcomeDto) {
    this.requireClientUser(ctx);
    try {
      await repo.recordInterviewOutcome(ctx, id, dto.recommendation, dto.notes);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Get(':id/training-confirmations')
  async trainingConfirmations(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    try {
      return await trainingRepo.listConfirmations(ctx, id);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Post(':id/confirm-training')
  async confirmTraining(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string, @Body() dto: ConfirmTrainingDto) {
    this.requireClientUser(ctx);
    try {
      await trainingRepo.confirmTraining(ctx, id, dto.kind, dto.notes);
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  @Post(':id/activate')
  async activate(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    this.requireClientUser(ctx);
    try {
      const { notificationId, recipientEmail, shouldSend, subject, body } = await trainingRepo.activateAccreditation(ctx, id);
      if (shouldSend) {
        await this.email.send(recipientEmail, subject, body);
        await markSent(notificationId);
      }
    } catch (err) {
      throw this.mapError(err);
    }
    return { ok: true };
  }

  private mapError(err: unknown): Error {
    if (err instanceof repo.AccreditationNotFoundError) return new NotFoundException(err.message);
    if (err instanceof repo.NoBusinessAffiliationError) return new ConflictException(err.message);
    if (err instanceof repo.NoActiveRelationshipError) return new ConflictException(err.message);
    if (err instanceof repo.InvalidAccreditationTransitionError) return new ConflictException(err.message);
    if (err instanceof repo.InsufficientRoleError) return new ForbiddenException(err.message);
    return err instanceof Error ? err : new Error(String(err));
  }
}
