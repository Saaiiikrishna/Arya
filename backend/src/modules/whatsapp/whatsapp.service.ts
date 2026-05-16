import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { PrismaService } from '../../prisma';

export interface WaTextComponent {
  type: 'body' | 'header' | 'footer';
  parameters: Array<{ type: 'text'; text: string } | { type: 'image'; image: { link: string } } | { type: 'document'; document: { link: string; filename: string } }>;
}

export interface WaButton {
  type: 'reply';
  reply: { id: string; title: string };
}

export interface SendTemplateParams {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: WaTextComponent[];
  /** Applicant ID for notification log; omit for staff/co-founder sends */
  applicantId?: string;
}

export interface BroadcastFilter {
  batchId?: string;
  teamId?: string;
  /** Defaults to requiring whatsappVerified = true */
  includeUnverified?: boolean;
}

const GRAPH_VERSION = 'v21.0';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiToken: string;
  private readonly phoneId: string;
  private readonly verifyToken: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private readonly isDev: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.apiToken = this.configService.get<string>('WHATSAPP_API_TOKEN') ?? '';
    this.phoneId = this.configService.get<string>('WHATSAPP_PHONE_ID') ?? '';
    this.verifyToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN') ?? '';
    this.appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET') ?? '';
    if (!this.verifyToken) {
      this.logger.warn('WHATSAPP_VERIFY_TOKEN is not set — webhook verification will reject all challenges');
    }
    if (!this.appSecret) {
      this.logger.warn('WHATSAPP_APP_SECRET is not set — webhook HMAC validation is disabled');
    }
    this.baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneId}/messages`;
    this.isDev = this.configService.get<string>('NODE_ENV') !== 'production';
  }

  // ─── Webhook ─────────────────────────────────────────────

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (!this.verifyToken) return null; // fail closed — env var not set
    if (mode === 'subscribe' && token === this.verifyToken) {
      return challenge;
    }
    return null;
  }

  /** Validates X-Hub-Signature-256 header. Returns true in dev when appSecret is unset. */
  validateHmac(rawBody: Buffer, signatureHeader: string): boolean {
    if (!this.appSecret) return true; // dev/unconfigured — skip
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
      return false; // length mismatch
    }
  }

  async handleWebhookEvent(payload: any): Promise<void> {
    const entries: any[] = payload?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;

        // Message status updates (delivered, read, failed)
        for (const status of value?.statuses ?? []) {
          this.logger.log(`WA status: ${status.status} for ${status.recipient_id}, msgId=${status.id}`);
          if (status.status === 'failed') {
            this.logger.error(`WA delivery failed for ${status.recipient_id}: ${JSON.stringify(status.errors)}`);
          }
        }

        // Incoming messages (user replies) — log metadata only, never log body (PII)
        for (const message of value?.messages ?? []) {
          const masked = `${String(message.from ?? '').slice(0, 4)}****`;
          this.logger.log(`WA incoming from ${masked}: type=${message.type}`);
        }
      }
    }
  }

  // ─── Core Send ───────────────────────────────────────────

  async sendTemplate(params: SendTemplateParams): Promise<boolean> {
    const { to, templateName, languageCode = 'en_US', components = [], applicantId } = params;
    const cleanPhone = to.replace(/\D/g, '');
    if (!cleanPhone) return false;

    if (this.isDev || !this.apiToken || this.apiToken === 'your_meta_token_here') {
      this.logger.log(`[WA MOCK] → ${cleanPhone}  template: ${templateName}  params: ${JSON.stringify(components)}`);
      if (applicantId) await this.logNotification(applicantId, templateName, `Mock send to ${cleanPhone}`, true);
      return true;
    }

    try {
      const res = await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'template',
          template: { name: templateName, language: { code: languageCode }, components },
        },
        { headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' } },
      );
      this.logger.log(`WA sent to ${cleanPhone}: msgId=${res.data.messages?.[0]?.id}`);
      if (applicantId) await this.logNotification(applicantId, templateName, `Sent to ${cleanPhone}`, true);
      return true;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      this.logger.error(`WA send failed → ${cleanPhone} template=${templateName}: ${msg}`);
      if (applicantId) await this.logNotification(applicantId, templateName, `Failed: ${msg}`, false);
      return false;
    }
  }

  /** Send an interactive message with quick-reply buttons (within 24h user-initiated window only). */
  async sendInteractiveButtons(
    phone: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    applicantId?: string,
  ): Promise<boolean> {
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) return false;

    if (this.isDev || !this.apiToken) {
      this.logger.log(`[WA MOCK] interactive → ${cleanPhone}: ${bodyText} | buttons: ${buttons.map(b => b.title).join(', ')}`);
      return true;
    }

    try {
      await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: bodyText },
            action: {
              buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
            },
          },
        },
        { headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' } },
      );
      if (applicantId) await this.logNotification(applicantId, 'interactive_button', bodyText, true);
      return true;
    } catch (err) {
      this.logger.error(`WA interactive failed → ${cleanPhone}: ${err.response?.data?.error?.message || err.message}`);
      return false;
    }
  }

  // ─── Platform Event Methods ───────────────────────────────

  /** AUTHENTICATION category — no opt-in required. */
  async sendOtp(phone: string, otp: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'otp_verification',
      components: [{ type: 'body', parameters: [{ type: 'text', text: otp }] }],
    });
  }

  async sendApplicationReceived(phone: string, firstName: string, applicantId: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'application_received',
      components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }],
      applicantId,
    });
  }

  async sendInterviewScheduled(
    phone: string,
    firstName: string,
    date: string,
    time: string,
    meetLink: string,
    applicantId: string,
  ): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'interview_scheduled',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: date },
          { type: 'text', text: time },
          { type: 'text', text: meetLink },
        ],
      }],
      applicantId,
    });
  }

  async sendInterviewSelected(phone: string, firstName: string, cohortNumber: string, applicantId: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'interview_decision_selected',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: cohortNumber },
        ],
      }],
      applicantId,
    });
  }

  async sendInterviewRejected(phone: string, firstName: string, applicantId: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'interview_decision_rejected',
      components: [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }],
      applicantId,
    });
  }

  async sendTeamAssignment(
    phone: string,
    firstName: string,
    teamName: string,
    mentorName: string,
    applicantId: string,
  ): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'team_assignment',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: teamName },
          { type: 'text', text: mentorName },
        ],
      }],
      applicantId,
    });
  }

  async sendTeamLocked(phone: string, firstName: string, teamName: string, applicantId: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'team_lock_confirmation',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: teamName },
        ],
      }],
      applicantId,
    });
  }

  async sendMentorAssigned(
    phone: string,
    firstName: string,
    mentorName: string,
    mentorContact: string,
    applicantId: string,
  ): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'mentor_assigned',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: mentorName },
          { type: 'text', text: mentorContact },
        ],
      }],
      applicantId,
    });
  }

  async sendCoFounderAssigned(
    phone: string,
    firstName: string,
    coFounderName: string,
    applicantId: string,
  ): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'co_founder_assigned',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: coFounderName },
        ],
      }],
      applicantId,
    });
  }

  async sendMvpComplete(phone: string, firstName: string, teamName: string, applicantId: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'mvp_milestone_complete',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: teamName },
        ],
      }],
      applicantId,
    });
  }

  async sendPitchInvitation(
    phone: string,
    firstName: string,
    teamName: string,
    pitchDate: string,
    venue: string,
    applicantId: string,
  ): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'pitch_invitation',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: teamName },
          { type: 'text', text: pitchDate },
          { type: 'text', text: venue },
        ],
      }],
      applicantId,
    });
  }

  async sendDeadlineReminder(
    phone: string,
    firstName: string,
    deadlineName: string,
    daysLeft: string,
    deadlineDate: string,
    applicantId: string,
  ): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'deadline_reminder',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: deadlineName },
          { type: 'text', text: daysLeft },
          { type: 'text', text: deadlineDate },
        ],
      }],
      applicantId,
    });
  }

  async sendWeeklyCheckInReminder(phone: string, firstName: string, teamName: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'weekly_checkin_reminder',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: teamName },
        ],
      }],
    });
  }

  /** MARKETING category — only sends to applicants with whatsappVerified=true. */
  async sendAnnouncement(phone: string, title: string, message: string, applicantId: string): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'platform_announcement',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: title },
          { type: 'text', text: message },
        ],
      }],
      applicantId,
    });
  }

  async sendReferralMilestone(
    phone: string,
    firstName: string,
    count: number,
    badgeName: string,
    applicantId: string,
  ): Promise<boolean> {
    return this.sendTemplate({
      to: phone,
      templateName: 'referral_milestone',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: String(count) },
          { type: 'text', text: badgeName },
        ],
      }],
      applicantId,
    });
  }

  // ─── Broadcast ───────────────────────────────────────────

  /**
   * Broadcast a template to all opted-in applicants matching the filter.
   * Rate-limited to ~80 sends/second (100ms gap). Returns send counts.
   */
  async broadcastTemplate(
    templateName: string,
    getComponents: (applicant: any) => WaTextComponent[],
    filter: BroadcastFilter = {},
  ): Promise<{ attempted: number; succeeded: number; failed: number }> {
    const where: any = {
      whatsappPhone: { not: null },
    };
    if (!filter.includeUnverified) where.whatsappVerified = true;
    if (filter.batchId) where.batchId = filter.batchId;
    if (filter.teamId) where.teamId = filter.teamId;

    const applicants = await this.prisma.applicant.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, whatsappPhone: true, batchId: true, teamId: true },
    });

    let succeeded = 0;
    let failed = 0;

    for (const applicant of applicants) {
      const ok = await this.sendTemplate({
        to: applicant.whatsappPhone!,
        templateName,
        components: getComponents(applicant),
        applicantId: applicant.id,
      });
      if (ok) succeeded++; else failed++;
      // 100ms gap to stay well under Meta's rate limit
      await new Promise(r => setTimeout(r, 100));
    }

    this.logger.log(`Broadcast ${templateName}: ${succeeded} sent, ${failed} failed out of ${applicants.length}`);
    return { attempted: applicants.length, succeeded, failed };
  }

  // ─── Admin Broadcast (arbitrary template + body text) ────

  /**
   * Admin-initiated broadcast with a free-text message body mapped to template parameter {{1}}.
   * Uses the `platform_announcement` template (MARKETING category).
   */
  async adminBroadcast(dto: {
    title: string;
    message: string;
    filter: BroadcastFilter;
  }): Promise<{ attempted: number; succeeded: number; failed: number }> {
    return this.broadcastTemplate(
      'platform_announcement',
      () => [{
        type: 'body',
        parameters: [
          { type: 'text', text: dto.title },
          { type: 'text', text: dto.message },
        ],
      }],
      dto.filter,
    );
  }

  // ─── Send Log ────────────────────────────────────────────

  async getSendLog(limit = 50, offset = 0) {
    return this.prisma.notification.findMany({
      where: { type: 'WHATSAPP' },
      orderBy: { sentAt: 'desc' },
      take: limit,
      skip: offset,
      include: { applicant: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  // ─── Template Reference ──────────────────────────────────

  /**
   * Returns the list of templates that must be created and approved in Meta Business Manager.
   * This is the authoritative registry — update here whenever you add a new template.
   */
  getTemplateRegistry(): Array<{ name: string; category: string; description: string; parameters: string[] }> {
    return [
      { name: 'otp_verification', category: 'AUTHENTICATION', description: 'OTP delivery for login', parameters: ['{{1}} = OTP code'] },
      { name: 'application_received', category: 'UTILITY', description: 'Confirm application submission', parameters: ['{{1}} = first name'] },
      { name: 'interview_scheduled', category: 'UTILITY', description: 'Interview booking confirmation', parameters: ['{{1}} = name', '{{2}} = date', '{{3}} = time', '{{4}} = meet link'] },
      { name: 'interview_decision_selected', category: 'UTILITY', description: 'Selection notification', parameters: ['{{1}} = name', '{{2}} = cohort number'] },
      { name: 'interview_decision_rejected', category: 'UTILITY', description: 'Rejection notification', parameters: ['{{1}} = name'] },
      { name: 'team_assignment', category: 'UTILITY', description: 'Team formed and assigned', parameters: ['{{1}} = name', '{{2}} = team name', '{{3}} = mentor name'] },
      { name: 'team_lock_confirmation', category: 'UTILITY', description: 'Team officially locked, sprint begins', parameters: ['{{1}} = name', '{{2}} = team name'] },
      { name: 'mentor_assigned', category: 'UTILITY', description: 'Mentor assignment notification', parameters: ['{{1}} = name', '{{2}} = mentor name', '{{3}} = mentor contact'] },
      { name: 'co_founder_assigned', category: 'UTILITY', description: 'Co-founder assignment notification', parameters: ['{{1}} = name', '{{2}} = co-founder name'] },
      { name: 'mvp_milestone_complete', category: 'UTILITY', description: 'All sprint milestones done', parameters: ['{{1}} = name', '{{2}} = team name'] },
      { name: 'pitch_invitation', category: 'UTILITY', description: 'Investor pitch invitation', parameters: ['{{1}} = name', '{{2}} = team name', '{{3}} = pitch date', '{{4}} = venue'] },
      { name: 'deadline_reminder', category: 'UTILITY', description: 'Upcoming task deadline reminder', parameters: ['{{1}} = name', '{{2}} = deadline name', '{{3}} = days left', '{{4}} = date'] },
      { name: 'weekly_checkin_reminder', category: 'UTILITY', description: 'Co-founder weekly check-in reminder', parameters: ['{{1}} = name', '{{2}} = team name'] },
      { name: 'platform_announcement', category: 'MARKETING', description: 'Admin broadcast / platform promotion', parameters: ['{{1}} = title', '{{2}} = message body'] },
      { name: 'referral_milestone', category: 'UTILITY', description: 'Referral badge earned', parameters: ['{{1}} = name', '{{2}} = referral count', '{{3}} = badge name'] },
      { name: 'batch_opening', category: 'MARKETING', description: 'New batch open for applications', parameters: ['{{1}} = batch number', '{{2}} = application URL'] },
    ];
  }

  // ─── Private ─────────────────────────────────────────────

  private async logNotification(applicantId: string, subject: string, body: string, success: boolean) {
    try {
      await this.prisma.notification.create({
        data: {
          applicantId,
          type: 'WHATSAPP',
          subject,
          body,
          status: success ? 'SENT' : 'FAILED',
          sentAt: success ? new Date() : undefined,
        },
      });
    } catch (e) {
      this.logger.error('Failed to log WhatsApp notification', e);
    }
  }
}
