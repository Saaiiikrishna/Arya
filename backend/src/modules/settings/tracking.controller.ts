import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VisitorService } from './visitor.service';
import type { PageViewEvent } from './visitor.service';
import type { Request } from 'express';

@Controller('api/track')
export class TrackingController {
  constructor(private readonly visitorService: VisitorService) {}

  /**
   * Public tracking endpoint — rate-limited to 30 req/min per IP.
   * Extracts IP and user-agent from the request headers.
   */
  @Post('pageview')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async trackPageView(@Body() body: PageViewEvent, @Req() req: Request) {
    // Extract real IP (supports proxies)
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';

    const userAgent = req.headers['user-agent'] || '';

    await this.visitorService.trackPageView({
      ...body,
      ip,
      userAgent,
    });
  }
}
