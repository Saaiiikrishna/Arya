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
