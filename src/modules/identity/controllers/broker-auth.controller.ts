import { Body, Controller, Post, Inject, UnauthorizedException, ConflictException, Headers, Ip, UseGuards } from '@nestjs/common';
import { IdentityService } from '../identity.service';
import { EMAIL_SENDER } from '../../notifications/notifications.module';
import { EmailSender } from '../../notifications/email-sender';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentAuthContext } from '../decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../../db/authorization-context';
import { InvalidCurrentPasswordError, InvalidResetTokenError, RefreshTokenReuseDetectedError } from '../identity.repository';
import { RegisterBrokerDto } from '../dto/register-broker.dto';
import { LoginDto } from '../dto/login.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { RequestPasswordResetDto } from '../dto/request-password-reset.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';

// AUTH-001–005 for brokers. Register and login are deliberately separate actions — no
// auto-login on register — so both stay independently auditable (see identity.repository.ts).
@Controller('auth/broker')
export class BrokerAuthController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterBrokerDto) {
    return this.identity.registerBroker(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string, @Ip() ip?: string) {
    const tokens = await this.identity.loginBroker(dto.email, dto.password, { userAgent, ipAddress: ip });
    if (!tokens) throw new UnauthorizedException('invalid email or password');
    return tokens;
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
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    try {
      await this.identity.changePassword(ctx, 'broker', ctx.actorId, dto.currentPassword, dto.newPassword);
    } catch (err) {
      if (err instanceof InvalidCurrentPasswordError) throw new UnauthorizedException(err.message);
      throw err;
    }
    return { ok: true };
  }

  @Post('request-password-reset')
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    const token = await this.identity.requestPasswordReset('broker', dto.email);
    // Always looks the same to the caller regardless of whether the email matched an
    // account (see identity.repository.ts's createPasswordResetToken) — no user
    // enumeration via this endpoint's response.
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
