import {
  Body,
  Controller,
  Post,
  Inject,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Headers,
  Ip,
  UseGuards,
} from '@nestjs/common';
import { IdentityService } from '../identity.service';
import { EMAIL_SENDER } from '../../notifications/notifications.module';
import { EmailSender } from '../../notifications/email-sender';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { MfaPendingGuard, MfaPendingType } from '../guards/mfa-pending.guard';
import { CurrentAuthContext } from '../decorators/current-auth-context.decorator';
import { CurrentMfaClientUserId } from '../decorators/current-mfa-client-user-id.decorator';
import { AuthorizationContext } from '../../../db/authorization-context';
import { InvalidCurrentPasswordError, InvalidResetTokenError, RefreshTokenReuseDetectedError } from '../identity.repository';
import { LoginDto } from '../dto/login.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { RequestPasswordResetDto } from '../dto/request-password-reset.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { VerifyMfaDto } from '../dto/verify-mfa.dto';
import { ConfirmMfaEnrolmentDto } from '../dto/confirm-mfa-enrolment.dto';

// AUTH-002/006 for client_users. /login never returns a full token pair — see
// identity.service.ts's loginClientUser and the MfaPendingGuard on every step below.
// AUTH-006 ("MFA mandatory") is enforced by this being the ONLY path from credentials
// to a full access token, not by a runtime check that could be bypassed.
@Controller('auth/client')
export class ClientAuthController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const result = await this.identity.loginClientUser(dto.email, dto.password);
    if (!result) throw new UnauthorizedException('invalid email or password');
    // tokenType tells the frontend whether to route to first-time enrolment or a
    // routine code-entry screen.
    return { pendingToken: result.pendingToken, tokenType: result.tokenType };
  }

  @Post('mfa/enroll')
  @UseGuards(MfaPendingGuard)
  @MfaPendingType('mfa_enrolment_pending')
  async beginEnrolment(@CurrentMfaClientUserId() clientUserId: string) {
    return this.identity.beginMfaEnrolment(clientUserId);
  }

  @Post('mfa/enroll/confirm')
  @UseGuards(MfaPendingGuard)
  @MfaPendingType('mfa_enrolment_pending')
  async confirmEnrolment(
    @CurrentMfaClientUserId() clientUserId: string,
    @Body() dto: ConfirmMfaEnrolmentDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ) {
    try {
      return await this.identity.confirmMfaEnrolment(clientUserId, dto.code, { userAgent, ipAddress: ip });
    } catch {
      throw new BadRequestException('invalid TOTP code');
    }
  }

  @Post('mfa/verify')
  @UseGuards(MfaPendingGuard)
  @MfaPendingType('mfa_pending')
  async verifyMfa(
    @CurrentMfaClientUserId() clientUserId: string,
    @Body() dto: VerifyMfaDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ) {
    if (!dto.code && !dto.backupCode) throw new BadRequestException('code or backupCode is required');
    try {
      return await this.identity.verifyMfaLogin(clientUserId, dto, { userAgent, ipAddress: ip });
    } catch {
      throw new UnauthorizedException('invalid MFA code');
    }
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Headers('user-agent') userAgent?: string, @Ip() ip?: string) {
    try {
      const tokens = await this.identity.refresh(dto.refreshToken, { userAgent, ipAddress: ip });
      if (!tokens) throw new UnauthorizedException('invalid or expired refresh token');
      return tokens;
    } catch (err) {
      if (err instanceof RefreshTokenReuseDetectedError) throw new UnauthorizedException(err.message);
      throw err;
    }
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.identity.logout(dto.refreshToken);
    return { ok: true };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentAuthContext() ctx: AuthorizationContext, @Body() dto: ChangePasswordDto) {
    if (ctx.actorType !== 'client_user') throw new UnauthorizedException();
    try {
      await this.identity.changePassword(ctx, 'client_user', ctx.actorId, dto.currentPassword, dto.newPassword);
    } catch (err) {
      if (err instanceof InvalidCurrentPasswordError) throw new UnauthorizedException(err.message);
      throw err;
    }
    return { ok: true };
  }

  @Post('request-password-reset')
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    const token = await this.identity.requestPasswordReset('client_user', dto.email);
    if (token) {
      await this.email.send(
        dto.email,
        'Reset your brok3r password',
        `Use this token to reset your password (valid for 1 hour): ${token}`,
      );
    }
    return { ok: true };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    try {
      await this.identity.resetPassword(dto.token, dto.newPassword);
    } catch (err) {
      if (err instanceof InvalidResetTokenError) throw new ConflictException(err.message);
      throw err;
    }
    return { ok: true };
  }
}
