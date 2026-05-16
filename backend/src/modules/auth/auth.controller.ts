import { Controller, Post, Body, UseGuards, Get, Request } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, CreateAdminDto } from './dto';
import { JwtAuthGuard, AdminGuard, RolesGuard } from './guards';
import { Roles } from './guards/roles.decorator';

@Controller('api/admin/auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google/callback')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async googleCallback(@Body('token') token: string) {
    return this.authService.googleLogin(token);
  }

  @Post('refresh')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @UseGuards(AdminGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('create')
  async createAdmin(@Body() dto: CreateAdminDto) {
    return this.authService.createAdmin(dto);
  }

  @Post('logout')
  async logout(@Body('refreshToken') refreshToken: string) {
    return this.authService.logout(refreshToken);
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
