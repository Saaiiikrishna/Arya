import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
export interface SendEmailParams {
    to: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
}
export declare class EmailService {
    private readonly configService;
    private readonly prisma;
    private readonly ses;
    private readonly fromEmail;
    private readonly logger;
    constructor(configService: ConfigService, prisma: PrismaService);
    sendEmail(params: SendEmailParams): Promise<boolean>;
    getTemplate(slug: string): Promise<{
        subject: string;
        body: string;
    } | null>;
    renderTemplate(template: string, variables: Record<string, string>): string;
    sendTemplatedEmail(to: string, templateSlug: string, variables: Record<string, string>, applicantId?: string): Promise<boolean>;
}
