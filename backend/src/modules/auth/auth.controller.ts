import { Controller, Post, Body, UseGuards, Get, Request } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, CreateAdminDto } from './dto';
import { JwtAuthGuard } from './guards';

@Controller('api/admin/auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('create')
  async createAdmin(@Body() dto: CreateAdminDto) {
    return this.authService.createAdmin(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: any) {
    const admin = req.user;
    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
    };
  }
}
