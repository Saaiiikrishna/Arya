import {
  Controller,
  Post,
  Get,
  Body,
  Request,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request as ExpressRequest, Response } from 'express';
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
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshToken,
  assertTrustedOrigin,
  STORE_REFRESH_COOKIE,
} from '../auth/refresh-cookie';

@Controller('api/store/auth')
@UseGuards(ThrottlerGuard)
export class StoreAuthController {
  constructor(
    private readonly storeAuthService: StoreAuthService,
    private readonly config: ConfigService,
  ) {}

  /** Set the store-customer refresh cookie from an auth result. */
  private setCookie(res: Response, result: { refreshToken: string }): void {
    setRefreshCookie(res, result.refreshToken, this.config, STORE_REFRESH_COOKIE);
  }

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
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.storeAuthService.verifyOtp(dto.email, dto.otp);
    this.setCookie(res, result);
    return result;
  }

  /** Register a new REGISTERED customer (email + password + name). */
  @Post('register')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async register(@Body() dto: RegisterCustomerDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.storeAuthService.register(dto);
    this.setCookie(res, result);
    return result;
  }

  /** Email + password login (Razorpay-only platform — no stored instruments). */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: CustomerLoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.storeAuthService.login(dto);
    this.setCookie(res, result);
    return result;
  }

  /** Google ID token → CUSTOMER token pair. */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async google(@Body() dto: GoogleAuthDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.storeAuthService.googleLogin(dto.token);
    this.setCookie(res, result);
    return result;
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
  async discord(@Body() dto: DiscordAuthDto, @Res({ passthrough: true }) res: Response) {
    // `state` is the anti-CSRF nonce returned alongside the code; the service
    // verifies + single-use-consumes it before exchanging the code.
    const result = await this.storeAuthService.discordLogin(dto.code, dto.state);
    this.setCookie(res, result);
    return result;
  }

  /**
   * Customer-specific refresh: rotate the pair, validating against Customer.
   * The token is read from the HttpOnly cookie (body fallback for API clients);
   * the rotated token is written back as a fresh cookie.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async refresh(
    @Req() req: ExpressRequest,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // CSRF: the cookie is SameSite=None, so reject forged cross-site rotations.
    assertTrustedOrigin(req, this.config);
    const presented = readRefreshToken(req, dto.refreshToken, STORE_REFRESH_COOKIE);
    if (!presented) {
      // Mirror the service's generic message — no presence/credential oracle.
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const result = await this.storeAuthService.refresh(presented);
    this.setCookie(res, result);
    return result;
  }

  /**
   * Revoke a refresh token (whole family). Rate-limited: besides the DB write,
   * the SHA-256 lookup makes an un-throttled logout a hash-enumeration oracle.
   * Reads the token from the cookie (body fallback) and clears the cookie.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async logout(
    @Req() req: ExpressRequest,
    @Body() dto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // CSRF: the cookie is SameSite=None, so reject forged cross-site logouts.
    assertTrustedOrigin(req, this.config);
    const presented = readRefreshToken(req, dto.refreshToken, STORE_REFRESH_COOKIE);
    clearRefreshCookie(res, this.config, STORE_REFRESH_COOKIE);
    if (presented) await this.storeAuthService.logout(presented);
    return { success: true };
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
