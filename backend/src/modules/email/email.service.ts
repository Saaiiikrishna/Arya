import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { PrismaService } from '../../prisma';

export interface SendEmailParams {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

@Injectable()
export class EmailService {
  private readonly ses: SESClient;
  private readonly fromEmail: string;
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.ses = new SESClient({
      region: this.configService.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
    const fromAddress = this.configService.get<string>('AWS_SES_FROM_EMAIL', 'noreply@example.com');
    const fromName = this.configService.get<string>('AWS_SES_FROM_NAME', 'Aryavartham');
    this.fromEmail = `${fromName} <${fromAddress}>`;
  }

  async sendEmail(params: SendEmailParams): Promise<boolean> {
    try {
      const command = new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [params.to] },
        Message: {
          Subject: { Data: params.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: params.htmlBody, Charset: 'UTF-8' },
            ...(params.textBody && {
              Text: { Data: params.textBody, Charset: 'UTF-8' },
            }),
          },
        },
      });

      await this.ses.send(command);
      this.logger.log(`Email sent to ${params.to}: ${params.subject}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${params.to}`, error);
      return false;
    }
  }

  async getTemplate(slug: string): Promise<{ subject: string; body: string } | null> {
    const template = await this.prisma.emailTemplate.findUnique({
      where: { slug },
    });
    return template ? { subject: template.subject, body: template.body } : null;
  }

  renderTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }

  /**
   * Wrap arbitrary inner HTML in the Aryavartham brand email shell
   * (Organic Brutalism: parchment ground, forest wordmark, terracotta-warm
   * label, hairline rules, 0px corners). Email-safe table layout + inline
   * styles; serif Georgia headings / sans body with web-safe fallbacks.
   */
  buildBrandedEmail(innerHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#FEF9F0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF9F0;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FDFBF7;border:1px solid #C2C8C2;">
        <tr><td style="padding:32px 40px 20px;border-bottom:1px solid #C2C8C2;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:#133022;line-height:1;">Aryavartham</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C94A38;margin-top:6px;">The Founder&rsquo;s Club</div>
        </td></tr>
        <tr><td style="padding:32px 40px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1D1C16;">
          ${innerHtml}
        </td></tr>
        <tr><td style="padding:20px 40px 28px;border-top:1px solid #C2C8C2;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#8a7d6a;">
          <div style="font-weight:700;color:#133022;">Aryavartham &mdash; The Founder&rsquo;s Club</div>
          <div style="margin-top:4px;">Build a Startup in 180 Days.</div>
          <div style="margin-top:10px;color:#a99e8c;">A brand by SKSC MYSILLYDREAMS Private Limited &middot; This is an automated message; please do not reply.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  async sendTemplatedEmail(
    to: string,
    templateSlug: string,
    variables: Record<string, string>,
    applicantId?: string,
  ): Promise<boolean> {
    const template = await this.getTemplate(templateSlug);
    if (!template) {
      this.logger.warn(`Email template '${templateSlug}' not found`);
      return false;
    }

    const subject = this.renderTemplate(template.subject, variables);
    const htmlBody = this.buildBrandedEmail(this.renderTemplate(template.body, variables));

    const success = await this.sendEmail({ to, subject, htmlBody });

    // Log notification
    if (applicantId) {
      await this.prisma.notification.create({
        data: {
          applicantId,
          type: 'EMAIL',
          subject,
          body: htmlBody,
          status: success ? 'SENT' : 'FAILED',
          sentAt: success ? new Date() : undefined,
        },
      });
    }

    return success;
  }
}
