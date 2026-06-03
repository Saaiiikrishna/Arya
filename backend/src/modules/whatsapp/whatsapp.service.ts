import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../prisma';

export interface WhatsappMessageParams {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: any[];
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiToken: string;
  private readonly phoneId: string;
  private readonly baseUrl: string;
  private readonly isDev: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.apiToken = this.configService.get<string>('WHATSAPP_API_TOKEN', '');
    this.phoneId = this.configService.get<string>('WHATSAPP_PHONE_ID', '');
    this.baseUrl = `https://graph.facebook.com/v17.0/${this.phoneId}/messages`;
    this.isDev = this.configService.get<string>('NODE_ENV') !== 'production';
  }

  async sendMessage(params: WhatsappMessageParams): Promise<boolean> {
    const { to, templateName, languageCode = 'en_US', components = [] } = params;

    // Clean phone number (remove +, spaces, leading zeros)
    const cleanPhone = to.replace(/\D/g, '');

    if (this.isDev || !this.apiToken || this.apiToken === 'your_meta_token_here') {
      this.logger.log(`[WHATSAPP MOCK] To: ${cleanPhone}, Template: ${templateName}, Components: ${JSON.stringify(components)}`);
      return true;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`WhatsApp sent to ${cleanPhone}: ID ${response.data.messages?.[0]?.id}`);
      return true;
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to send WhatsApp to ${cleanPhone}: ${errorMsg}`);
      return false;
    }
  }

  /**
   * Send a welcome message to a new applicant
   */
  async sendWelcome(to: string, firstName: string, applicantId?: string): Promise<boolean> {
    const success = await this.sendMessage({
      to,
      templateName: 'welcome_founders_club', // Ensure this template exists in Meta dashboard
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: firstName },
          ],
        },
      ],
    });

    if (applicantId) {
      await this.logNotification(applicantId, 'Welcome Message', `Welcome message sent to ${to}`, success);
    }

    return success;
  }

  /**
   * Send referral milestone notification
   */
  async sendReferralMilestone(to: string, firstName: string, count: number, badgeName: string, applicantId?: string): Promise<boolean> {
    const success = await this.sendMessage({
      to,
      templateName: 'referral_milestone',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: firstName },
            { type: 'text', text: String(count) },
            { type: 'text', text: badgeName },
          ],
        },
      ],
    });

    if (applicantId) {
      await this.logNotification(applicantId, 'Referral Milestone', `Milestone reached: ${count} referrals. Awarded ${badgeName} badge.`, success);
    }

    return success;
  }

  // ─── Milestone helpers (centralize Meta template component formatting) ──
  private body(...texts: (string | number)[]) {
    return [{ type: 'body', parameters: texts.map((t) => ({ type: 'text', text: String(t ?? '') })) }];
  }

  /** Best-effort WhatsApp send to a possibly-missing phone; never throws. */
  private async notify(
    to: string | null | undefined,
    templateName: string,
    components: any[],
    applicantId?: string,
    subject?: string,
  ): Promise<boolean> {
    if (!to) return false;
    let ok = false;
    try {
      ok = await this.sendMessage({ to, templateName, components });
    } catch (e) {
      this.logger.error(`WhatsApp ${templateName} failed: ${(e as any)?.message}`);
    }
    if (applicantId) await this.logNotification(applicantId, subject || templateName, `${templateName} → ${to}`, ok);
    return ok;
  }

  sendOtpWhatsApp(to: string, otp: string) {
    return this.notify(to, 'otp_verification', this.body(otp));
  }
  sendApplicationReceived(to: string, firstName: string, applicantId?: string) {
    return this.notify(to, 'application_received', this.body(firstName), applicantId, 'Application Received');
  }
  sendInterviewScheduled(to: string, name: string, date: string, time: string, meetLink: string, applicantId?: string) {
    return this.notify(to, 'interview_scheduled', this.body(name, date, time, meetLink), applicantId, 'Interview Scheduled');
  }
  sendInterviewDecision(to: string, selected: boolean, name: string, cohortNumber: string, applicantId?: string) {
    return selected
      ? this.notify(to, 'interview_decision_selected', this.body(name, cohortNumber), applicantId, 'Interview Decision')
      : this.notify(to, 'interview_decision_rejected', this.body(name), applicantId, 'Interview Decision');
  }
  sendTeamAssignment(to: string, name: string, teamName: string, mentorName: string, applicantId?: string) {
    return this.notify(to, 'team_assignment', this.body(name, teamName, mentorName), applicantId, 'Team Assignment');
  }
  sendDeadlineReminder(to: string, name: string, deadlineName: string, daysLeft: string, date: string, applicantId?: string) {
    return this.notify(to, 'deadline_reminder', this.body(name, deadlineName, daysLeft, date), applicantId, 'Deadline Reminder');
  }
  sendPlatformAnnouncement(to: string, title: string, message: string, applicantId?: string) {
    return this.notify(to, 'platform_announcement', this.body(title, message), applicantId, 'Announcement');
  }
  sendBatchOpening(to: string, batchNumber: string, applyUrl: string) {
    return this.notify(to, 'batch_opening', this.body(batchNumber, applyUrl));
  }

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
      this.logger.error('Failed to log WhatsApp notification to database', e);
    }
  }
}
