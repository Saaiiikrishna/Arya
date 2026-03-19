"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var EmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_ses_1 = require("@aws-sdk/client-ses");
const prisma_1 = require("../../prisma");
let EmailService = EmailService_1 = class EmailService {
    configService;
    prisma;
    ses;
    fromEmail;
    logger = new common_1.Logger(EmailService_1.name);
    constructor(configService, prisma) {
        this.configService = configService;
        this.prisma = prisma;
        this.ses = new client_ses_1.SESClient({
            region: this.configService.get('AWS_REGION', 'ap-south-1'),
            credentials: {
                accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID', ''),
                secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY', ''),
            },
        });
        this.fromEmail = this.configService.get('AWS_SES_FROM_EMAIL', 'noreply@example.com');
    }
    async sendEmail(params) {
        try {
            const command = new client_ses_1.SendEmailCommand({
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
        }
        catch (error) {
            this.logger.error(`Failed to send email to ${params.to}`, error);
            return false;
        }
    }
    async getTemplate(slug) {
        const template = await this.prisma.emailTemplate.findUnique({
            where: { slug },
        });
        return template ? { subject: template.subject, body: template.body } : null;
    }
    renderTemplate(template, variables) {
        let result = template;
        for (const [key, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }
        return result;
    }
    async sendTemplatedEmail(to, templateSlug, variables, applicantId) {
        const template = await this.getTemplate(templateSlug);
        if (!template) {
            this.logger.warn(`Email template '${templateSlug}' not found`);
            return false;
        }
        const subject = this.renderTemplate(template.subject, variables);
        const htmlBody = this.renderTemplate(template.body, variables);
        const success = await this.sendEmail({ to, subject, htmlBody });
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
};
exports.EmailService = EmailService;
exports.EmailService = EmailService = EmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_1.PrismaService])
], EmailService);
//# sourceMappingURL=email.service.js.map