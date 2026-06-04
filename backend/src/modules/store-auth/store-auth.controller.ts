import {
  Controller,
  Post,
  Get,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { StoreAuthService } from './store-auth.service';
import {
  RegisterCustomerDto,
  CustomerLoginDto,
  RefreshTokenDto,
  LogoutDto,
  RequestOtpDto,
  VerifyOtpDto,
  GoogleAuthDto,
  DiscordAuthDto,
  ConvertGuestDto,
} from './dto';
import { CustomerJwtGuard } from './guards';

@Controller('api/store/auth')
@UseGuards(ThrottlerGuard)
export class StoreAuthController {
  constructor(private readonly storeAuthService: StoreAuthService) {}

  /** Request a one-time login code (email, optional WhatsApp). */
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.storeAuthService.requestOtp(dto.email);
  }

  /** Verify a one-time code → CUSTOMER token pair (lazy account provisioning). */
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.storeAuthService.verifyOtp(dto.email, dto.otp);
  }

  /** Register a new REGISTERED customer (email + password + name). */
  @Post('register')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async register(@Body() dto: RegisterCustomerDto) {
    return this.storeAuthService.register(dto);
  }

  /** Email + password login (Razorpay-only platform — no stored instruments). */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: CustomerLoginDto) {
    return this.storeAuthService.login(dto);
  }

  /** Google ID token → CUSTOMER token pair. */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async google(@Body() dto: GoogleAuthDto) {
    return this.storeAuthService.googleLogin(dto.token);
  }

  /**
   * Discord OAuth2 authorize URL the storefront redirects to. Returns 404 when
   * Discord is not configured so the frontend hides the "Continue with Discord"
   * button (config-gated feature, mirroring the existing disabled-CTA pattern).
   */
  @Get('discord/url')
  @Throttle({ short: { limit: 30, ttl: 60000 } })
  async discordUrl() {
    // Async: mints + persists the single-use anti-CSRF `state` nonce embedded in
    // the returned authorize URL.
    const url = await this.storeAuthService.getDiscordAuthUrl();
    if (!url) {
      throw new NotFoundException('Discord login is not configured');
    }
    return { url };
  }

  /** Discord OAuth2 authorization code → CUSTOMER token pair. */
  @Post('discord')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async discord(@Body() dto: DiscordAuthDto) {
    // `state` is the anti-CSRF nonce returned alongside the code; the service
    // verifies + single-use-consumes it before exchanging the code.
    return this.storeAuthService.discordLogin(dto.code, dto.state);
  }

  /** Customer-specific refresh: rotate the pair, validating against Customer. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.storeAuthService.refresh(dto.refreshToken);
  }

  /**
   * Revoke a refresh token. Rate-limited: besides the DB write, the SHA-256
   * lookup makes an un-throttled logout a hash-enumeration oracle. Strict tier.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async logout(@Body() dto: LogoutDto) {
    return this.storeAuthService.logout(dto.refreshToken);
  }

  /** Merge a guest cart into the authenticated customer's cart (first login). */
  @UseGuards(CustomerJwtGuard)
  @Post('convert-guest')
  @HttpCode(HttpStatus.OK)
  async convertGuest(@Request() req: any, @Body() dto: ConvertGuestDto) {
    // Customer identity is pinned to the verified JWT, never the request body.
    return this.storeAuthService.convertGuest(req.user.id, dto.cartToken);
  }

  /** Authenticated customer profile. */
  @UseGuards(CustomerJwtGuard)
  @Get('me')
  async me(@Request() req: any) {
    // Identity is read from the verified CUSTOMER JWT, never the request body.
    return this.storeAuthService.me(req.user.id);
  }
}
