import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller('api')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  // ─── Webhook (public — Meta calls this) ──────────────────

  /**
   * GET /api/whatsapp/webhook
   * Meta sends a challenge during webhook verification setup.
   */
  @Get('whatsapp/webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = this.whatsappService.verifyWebhook(mode, token, challenge);
    if (result !== null) {
      res.status(200).send(result);
    } else {
      res.status(403).send('Forbidden');
    }
  }

  /**
   * POST /api/whatsapp/webhook
   * Receives all incoming events: message status updates, user replies.
   * Must return 200 quickly — Meta retries if it times out.
   */
  @Post('whatsapp/webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(@Body() payload: any) {
    // Fire-and-forget — do not await; Meta needs the 200 immediately
    this.whatsappService.handleWebhookEvent(payload).catch(() => {});
    return { status: 'ok' };
  }

  // ─── Admin Endpoints ──────────────────────────────────────

  /**
   * GET /api/admin/whatsapp/templates
   * Returns the template registry — what templates must exist in Meta Business Manager.
   */
  @UseGuards(AdminGuard)
  @Get('admin/whatsapp/templates')
  getTemplates() {
    return this.whatsappService.getTemplateRegistry();
  }

  /**
   * POST /api/admin/whatsapp/broadcast
   * Admin broadcasts a platform_announcement template to all opted-in applicants.
   * Supports optional batchId/teamId filter.
   */
  @UseGuards(AdminGuard)
  @Post('admin/whatsapp/broadcast')
  async broadcast(@Body() dto: {
    title: string;
    message: string;
    batchId?: string;
    teamId?: string;
  }) {
    if (!dto.title?.trim() || !dto.message?.trim()) {
      throw new BadRequestException('title and message are required');
    }
    return this.whatsappService.adminBroadcast({
      title: dto.title,
      message: dto.message,
      filter: { batchId: dto.batchId, teamId: dto.teamId },
    });
  }

  /**
   * GET /api/admin/whatsapp/send-log
   * Paginated WhatsApp send history from the notification table.
   */
  @UseGuards(AdminGuard)
  @Get('admin/whatsapp/send-log')
  getSendLog(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.whatsappService.getSendLog(
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
  }

  /**
   * POST /api/admin/whatsapp/send
   * One-off send to a specific phone number using any registered template.
   */
  @UseGuards(AdminGuard)
  @Post('admin/whatsapp/send')
  async sendOne(@Body() dto: {
    phone: string;
    templateName: string;
    parameters: string[];
  }) {
    if (!dto.phone || !dto.templateName) {
      throw new BadRequestException('phone and templateName are required');
    }
    const components = dto.parameters?.length
      ? [{ type: 'body' as const, parameters: dto.parameters.map(p => ({ type: 'text' as const, text: p })) }]
      : [];
    return { sent: await this.whatsappService.sendTemplate({ to: dto.phone, templateName: dto.templateName, components }) };
  }
}
