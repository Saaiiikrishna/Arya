import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

@Controller('api/auth/otp')
@UseGuards(ThrottlerGuard)
export class OtpController {
  constructor(private readonly authService: AuthService) {}

  @Post('send')
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 sends per minute
  async sendOtp(@Body('email') email: string) {
    return this.authService.sendOtp(email);
  }

  @Post('verify')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 verifies per minute
  async verifyOtp(@Body() body: { email: string; otp: string }) {
    return this.authService.verifyOtp(body.email, body.otp);
  }
}
