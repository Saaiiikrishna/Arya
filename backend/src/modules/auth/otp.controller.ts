import { Controller, Post, Body, UseGuards, Req, Res } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken } from './refresh-cookie';

@Controller('api/auth/otp')
@UseGuards(ThrottlerGuard)
export class OtpController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('send')
  @Throttle({ short: { limit: 3, ttl: 60000 } }) // 3 sends per minute
  async sendOtp(@Body('email') email: string) {
    return this.authService.sendOtp(email);
  }

  @Post('verify')
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 verifies per minute
  async verifyOtp(
    @Body() body: { email: string; otp: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(body.email, body.otp);
    setRefreshCookie(res, result.refreshToken, this.config);
    return result;
  }

  @Post('logout')
  async logout(
    @Req() req: ExpressRequest,
    @Body('refreshToken') bodyToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = readRefreshToken(req, bodyToken);
    clearRefreshCookie(res, this.config);
    if (presented) await this.authService.logout(presented);
    return { success: true };
  }
}
