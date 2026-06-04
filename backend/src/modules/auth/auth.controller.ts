import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Request,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, CreateAdminDto } from './dto';
import { JwtAuthGuard, AdminGuard, RolesGuard } from './guards';
import { Roles } from './guards/roles.decorator';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken } from './refresh-cookie';

@Controller('api/admin/auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    setRefreshCookie(res, result.refreshToken, this.config);
    return result;
  }

  @Post('google/callback')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async googleCallback(
    @Body('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.googleLogin(token);
    setRefreshCookie(res, result.refreshToken, this.config);
    return result;
  }

  @Post('refresh')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async refresh(
    @Req() req: ExpressRequest,
    @Body('refreshToken') bodyToken: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = readRefreshToken(req, bodyToken);
    if (!presented) throw new UnauthorizedException('Refresh token required');
    const result = await this.authService.refreshToken(presented);
    setRefreshCookie(res, result.refreshToken, this.config);
    return result;
  }

  @UseGuards(AdminGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('create')
  async createAdmin(@Body() dto: CreateAdminDto) {
    return this.authService.createAdmin(dto);
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

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: any) {
    const user = req.user;
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      avatarUrl: (user as any).avatarUrl,
    };
  }
}
