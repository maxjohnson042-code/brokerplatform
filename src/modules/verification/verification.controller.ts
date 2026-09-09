import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../../config/env';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import { EMAIL_SENDER } from '../notifications/notifications.module';
import { EmailSender } from '../notifications/email-sender';
import { markSent } from '../notifications/notification.repository';
import { getBrokerProfile } from '../brokers/brokers.repository';
import { getBusiness } from '../businesses/businesses.repository';
import * as repo from './identity-verification.repository';
import { verifySumsubSignature } from './webhook-signature';
import { DecideVerificationDto } from './dto/decide-verification.dto';

// IDV-*: broker-triggered ID&V (IDV-001/002), reviewer decide (IDV-005), full result
// view (IDV-006/010). The webhook route is deliberately the only one in this module —
// and the only public one in this codebase — without @UseGuards(JwtAuthGuard): Sumsub
// calls it directly, authenticated by signature instead of a session.
@Controller('verification')
export class VerificationController {
  constructor(@Inject(EMAIL_SENDER) private readonly email: EmailSender) {}

  private async dispatch(result: { notificationId: string; recipientEmail: string; shouldSend: boolean; subject: string; body: string }) {
    if (result.shouldSend) {
      await this.email.send(result.recipientEmail, result.subject, result.body);
      await markSent(result.notificationId);
    }
  }

  @Post('kyc')
  @UseGuards(JwtAuthGuard)
  async initiateKyc(@CurrentAuthContext() ctx: AuthorizationContext) {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    const profile = await getBrokerProfile(ctx, ctx.actorId);
    if (!profile) throw new NotFoundException();

    const result = await repo.initiateVerification(ctx, {
      kind: 'individual',
      brokerProfileId: ctx.actorId,
      firstName: profile.first_name as string,
      lastName: profile.last_name as string,
      dateOfBirth: (profile.date_of_birth as string | null) ?? undefined,
    });
    await this.dispatch(result);
    return { hostedLinkUrl: result.hostedLinkUrl };
  }

  @Post('kyb/:businessId')
  @UseGuards(JwtAuthGuard)
  async initiateKyb(@CurrentAuthContext() ctx: AuthorizationContext, @Param('businessId') businessId: string) {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    const business = await getBusiness(ctx, businessId);
    if (!business) throw new NotFoundException();

    const result = await repo.initiateVerification(ctx, {
      kind: 'business',
      brokerBusinessId: businessId,
      legalName: business.legal_name as string,
      abn: (business.abn as string | null) ?? undefined,
    });
    await this.dispatch(result);
    return { ok: true };
  }

  @Post('webhooks/sumsub')
  @HttpCode(200)
  async sumsubWebhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['x-payload-digest'];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;
    if (!req.rawBody || !verifySumsubSignature(req.rawBody, signatureHeader, env.sumsub.webhookSecret, env.sumsub.webhookDigestAlg)) {
      throw new ForbiddenException('invalid signature');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('invalid payload');
    }

    await repo.recordWebhookResult(payload);
    return { ok: true };
  }

  @Get('check-results/:id')
  @UseGuards(JwtAuthGuard)
  async getFullResult(@CurrentAuthContext() ctx: AuthorizationContext, @Param('id') id: string) {
    return repo.getFullResult(ctx, id);
  }

  @Post('check-results/:id/decide')
  @UseGuards(JwtAuthGuard)
  async decide(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('id') id: string,
    @Body() dto: DecideVerificationDto,
  ) {
    if (ctx.actorType !== 'client_user') throw new UnauthorizedException();
    const result = await repo.reviewerDecide(ctx, id, dto.decision);
    await this.dispatch(result);
    return { ok: true };
  }
}
