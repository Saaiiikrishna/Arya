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
    const fromName = this.configService.get<string>('AWS_SES_FROM_NAME', 'Aryavartham Support');
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
    const htmlBody = this.renderTemplate(template.body, variables);

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
