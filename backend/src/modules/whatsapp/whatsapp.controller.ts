import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Req,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { AdminGuard } from '../auth/guards';
import { PrismaService } from '../../prisma';

// ─── Template Registry ─────────────────────────────────────────────────────
// Each entry describes a Meta-approved template and its parameter layout.
// This is the single source of truth referenced by the admin UI and broadcasts.
export const WHATSAPP_TEMPLATES = [
  // ── AUTHENTICATION ──────────────────────────────────────────────────────
  {
    name: 'otp_verification',
    category: 'AUTHENTICATION',
    description: 'OTP delivery',
    params: [{ index: 1, label: 'OTP code' }],
  },
  // ── UTILITY ─────────────────────────────────────────────────────────────
  {
    name: 'welcome_founders_club',
    category: 'UTILITY',
    description: 'New applicant welcome message',
    params: [{ index: 1, label: 'first name' }],
  },
  {
    name: 'application_received',
    category: 'UTILITY',
    description: 'Application confirmation',
    params: [{ index: 1, label: 'first name' }],
  },
  {
    name: 'interview_scheduled',
    category: 'UTILITY',
    description: 'Interview booking',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'date' },
      { index: 3, label: 'time' },
      { index: 4, label: 'meet link' },
    ],
  },
  {
    name: 'interview_decision_selected',
    category: 'UTILITY',
    description: 'Selection notification',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'cohort number' },
    ],
  },
  {
    name: 'interview_decision_rejected',
    category: 'UTILITY',
    description: 'Rejection notification',
    params: [{ index: 1, label: 'name' }],
  },
  {
    name: 'team_assignment',
    category: 'UTILITY',
    description: 'Team formation',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'team name' },
      { index: 3, label: 'mentor name' },
    ],
  },
  {
    name: 'team_lock_confirmation',
    category: 'UTILITY',
    description: 'Team locked notification',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'team name' },
    ],
  },
  {
    name: 'mentor_assigned',
    category: 'UTILITY',
    description: 'Mentor assignment',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'mentor name' },
      { index: 3, label: 'mentor contact' },
    ],
  },
  {
    name: 'co_founder_assigned',
    category: 'UTILITY',
    description: 'Co-founder assignment',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'co-founder name' },
    ],
  },
  {
    name: 'mvp_milestone_complete',
    category: 'UTILITY',
    description: 'MVP sprint milestone completion',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'team name' },
    ],
  },
  {
    name: 'pitch_invitation',
    category: 'UTILITY',
    description: 'Investor pitch event invitation',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'team name' },
      { index: 3, label: 'date' },
      { index: 4, label: 'venue' },
    ],
  },
  {
    name: 'deadline_reminder',
    category: 'UTILITY',
    description: 'Task deadline reminder',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'deadline name' },
      { index: 3, label: 'days left' },
      { index: 4, label: 'date' },
    ],
  },
  {
    name: 'weekly_checkin_reminder',
    category: 'UTILITY',
    description: "Co-founder weekly check-in reminder",
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'team name' },
    ],
  },
  {
    name: 'batch_opening',
    category: 'UTILITY',
    description: 'New batch announcement',
    params: [
      { index: 1, label: 'batch number' },
      { index: 2, label: 'application URL' },
    ],
  },
  // ── MARKETING ───────────────────────────────────────────────────────────
  {
    name: 'platform_announcement',
    category: 'MARKETING',
    description: 'Admin broadcast (footer: Reply STOP to unsubscribe)',
    params: [
      { index: 1, label: 'title' },
      { index: 2, label: 'message body' },
    ],
  },
  {
    name: 'referral_milestone',
    category: 'MARKETING',
    description: 'Referral badge earned (footer: Reply STOP to unsubscribe)',
    params: [
      { index: 1, label: 'name' },
      { index: 2, label: 'referral count' },
      { index: 3, label: 'badge name' },
    ],
  },
];

// ─── Controller ────────────────────────────────────────────────────────────
@Controller('api')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Public Webhook ──────────────────────────────────────────────────────

  /**
   * GET /api/whatsapp/webhook
   * Meta calls this to verify the webhook URL during setup.
   * It sends hub.mode=subscribe, hub.verify_token, hub.challenge.
   * We respond with hub.challenge if the verify token matches.
   */
  @Get('whatsapp/webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('WhatsApp webhook verified successfully');
      return res.status(200).send(challenge);
    }

    this.logger.warn(`Webhook verification failed. Received token: ${token}`);
    return res.status(403).json({ error: 'Forbidden' });
  }

  /**
   * POST /api/whatsapp/webhook
   * Receives incoming events (delivery receipts, incoming messages, status updates).
   * We validate the HMAC signature then process asynchronously.
   */
  @Post('whatsapp/webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(@Req() req: Request, @Res() res: Response) {
    // Validate HMAC signature from Meta
    // Fail closed: a missing secret or unverifiable body must be rejected,
    // never silently accepted as an unsigned webhook.
    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      this.logger.error('WHATSAPP_APP_SECRET not set; rejecting webhook');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) {
      this.logger.warn('Missing X-Hub-Signature-256 header');
      return res.status(403).json({ error: 'Missing signature' });
    }

    const rawBody = (req as any).rawBody as Buffer;
    if (!rawBody) {
      this.logger.error('Cannot verify webhook signature: rawBody unavailable');
      return res.status(403).json({ error: 'Cannot verify signature' });
    }

    const expectedSig =
      'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    try {
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSig);
      if (
        sigBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        this.logger.warn('Invalid HMAC signature on webhook');
        return res.status(403).json({ error: 'Invalid signature' });
      }
    } catch {
      return res.status(403).json({ error: 'Signature validation error' });
    }

    // Respond immediately to Meta (within 20 s requirement)
    res.status(200).json({ received: true });

    // Process the event asynchronously
    const body = req.body;
    this.processWebhookEvent(body);
  }

  // ─── Admin Endpoints ─────────────────────────────────────────────────────

  /**
   * GET /api/admin/whatsapp/templates
   * Returns the full template registry so the admin UI can display
   * exact names, categories, and parameter layouts.
   */
  @UseGuards(AdminGuard)
  @Get('admin/whatsapp/templates')
  getTemplates() {
    return { templates: WHATSAPP_TEMPLATES };
  }

  /**
   * POST /api/admin/whatsapp/send
   * Send a one-off template message to a specific phone number.
   */
  @UseGuards(AdminGuard)
  @Post('admin/whatsapp/send')
  async sendOneOff(
    @Body()
    body: {
      to: string;
      templateName: string;
      components?: any[];
      languageCode?: string;
    },
  ) {
    const success = await this.whatsappService.sendMessage({
      to: body.to,
      templateName: body.templateName,
      components: body.components,
      languageCode: body.languageCode,
    });

    return { success, to: body.to, template: body.templateName };
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async processWebhookEvent(body: any) {
    try {
      if (body?.object !== 'whatsapp_business_account') return;

      for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          const value = change?.value;

          // Incoming message (user replied to us)
          for (const message of value?.messages ?? []) {
            this.logger.log(
              `Incoming WhatsApp message from ${message.from}: type=${message.type}`,
            );

            // Handle STOP replies — mark user as opted out
            if (
              message.type === 'text' &&
              message.text?.body?.trim().toUpperCase() === 'STOP'
            ) {
              this.logger.log(
                `User ${message.from} opted out of WhatsApp notifications`,
              );
              await this.optOutByPhone(message.from);
            }
          }

          // Delivery / read status updates
          for (const status of value?.statuses ?? []) {
            this.logger.log(
              `WhatsApp status update: msgId=${status.id} status=${status.status} recipient=${status.recipient_id}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.error('Error processing webhook event', err);
    }
  }

  /**
   * Mark the applicant matching the given WhatsApp number as opted out by
   * setting whatsappOptOut=true, so the platform stops messaging them. This is
   * deliberately separate from whatsappVerified (a verification gate) — reusing
   * that flag would also suppress sends to not-yet-verified users.
   *
   * Meta delivers `from` as bare digits (e.g. "919876543210") while stored
   * phone numbers may carry "+", spaces, or leading zeros. We therefore match
   * on normalized digits rather than relying on exact string equality.
   * Best-effort: failures are logged and never propagated to the webhook flow.
   */
  private async optOutByPhone(from: string): Promise<void> {
    try {
      const normalized = (from ?? '').replace(/\D/g, '');
      if (!normalized) return;

      // Narrow candidates with a cheap substring filter on either stored
      // number, then confirm an exact match on digits-only normalization.
      // Opt-out applies regardless of verification status.
      const candidates = await this.prisma.applicant.findMany({
        where: {
          OR: [
            { phone: { contains: normalized } },
            { whatsappPhone: { contains: normalized } },
          ],
        },
        select: { id: true, phone: true, whatsappPhone: true },
      });

      const matches = candidates.filter((a) => {
        const phoneDigits = (a.phone ?? '').replace(/\D/g, '');
        const waDigits = (a.whatsappPhone ?? '').replace(/\D/g, '');
        return phoneDigits === normalized || waDigits === normalized;
      });

      if (matches.length === 0) {
        this.logger.warn(
          `STOP opt-out: no applicant found for ${from}`,
        );
        return;
      }

      await this.prisma.applicant.updateMany({
        where: { id: { in: matches.map((a) => a.id) } },
        data: { whatsappOptOut: true },
      });

      this.logger.log(
        `STOP opt-out: marked ${matches.length} applicant(s) whatsappOptOut=true for ${from}`,
      );
    } catch (err) {
      this.logger.error(`Failed to process STOP opt-out for ${from}`, err);
    }
  }
}
