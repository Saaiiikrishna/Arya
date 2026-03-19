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
var BatchProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchProcessor = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../prisma");
const batch_1 = require("../batch");
const team_1 = require("../team");
const eligibility_1 = require("../eligibility");
const email_1 = require("../email");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
let BatchProcessor = BatchProcessor_1 = class BatchProcessor extends bullmq_1.WorkerHost {
    prisma;
    batchService;
    teamService;
    eligibilityService;
    emailService;
    configService;
    logger = new common_1.Logger(BatchProcessor_1.name);
    constructor(prisma, batchService, teamService, eligibilityService, emailService, configService) {
        super();
        this.prisma = prisma;
        this.batchService = batchService;
        this.teamService = teamService;
        this.eligibilityService = eligibilityService;
        this.emailService = emailService;
        this.configService = configService;
    }
    async process(job) {
        switch (job.name) {
            case 'check-batch-capacity':
                return this.handleCheckBatchCapacity(job);
            case 'screen-batch':
                return this.handleScreenBatch(job);
            case 'form-teams':
                return this.handleFormTeams(job);
            case 'backfill-cascade':
                return this.handleBackfillCascade(job);
            case 'send-batch-notifications':
                return this.handleSendBatchNotifications(job);
            default:
                this.logger.warn(`Unknown job: ${job.name}`);
        }
    }
    async handleCheckBatchCapacity(job) {
        this.logger.log('Checking batch capacity...');
        const result = await this.batchService.checkAndCreateBatch();
        if (result.triggered && result.batchId) {
            const batch = await this.prisma.batch.findUnique({
                where: { id: result.batchId },
            });
            if (batch) {
                this.logger.log(`Batch ${batch.batchNumber} is full. Auto-screening...`);
                await this.eligibilityService.screenBatch(result.batchId);
            }
        }
        return result;
    }
    async handleScreenBatch(job) {
        const { batchId } = job.data;
        this.logger.log(`Screening batch ${batchId}...`);
        return this.eligibilityService.screenBatch(batchId);
    }
    async handleFormTeams(job) {
        const { batchId } = job.data;
        this.logger.log(`Forming teams for batch ${batchId}...`);
        return this.teamService.formTeams(batchId);
    }
    async handleBackfillCascade(job) {
        const { batchId, removedCount = 1 } = job.data;
        this.logger.log(`Backfill cascade for batch ${batchId}, need ${removedCount} users`);
        const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
        if (!batch)
            return;
        const nextBatch = await this.prisma.batch.findFirst({
            where: { batchNumber: { gt: batch.batchNumber } },
            orderBy: { batchNumber: 'asc' },
        });
        if (!nextBatch) {
            this.logger.log('No next batch available for backfill');
            return;
        }
        const movedApplicants = await this.prisma.applicant.findMany({
            where: { batchId: nextBatch.id, status: { not: 'REMOVED' } },
            orderBy: { appliedAt: 'asc' },
            take: removedCount,
        });
        const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
        for (const applicant of movedApplicants) {
            await this.prisma.$transaction([
                this.prisma.applicant.update({
                    where: { id: applicant.id },
                    data: {
                        batchId: batch.id,
                        movedAt: new Date(),
                        status: client_1.ApplicantStatus.ELIGIBLE,
                        teamId: null,
                    },
                }),
                this.prisma.batch.update({
                    where: { id: batch.id },
                    data: { currentCount: { increment: 1 } },
                }),
                this.prisma.batch.update({
                    where: { id: nextBatch.id },
                    data: { currentCount: { decrement: 1 } },
                }),
            ]);
            await this.teamService.matchToExistingTeam(applicant.id, batch.id);
            await this.emailService.sendTemplatedEmail(applicant.email, 'user-moved-to-batch', {
                firstName: applicant.firstName,
                oldBatchNumber: String(nextBatch.batchNumber),
                newBatchNumber: String(batch.batchNumber),
                statusUrl: `${frontendUrl}/applicants/status/${applicant.accessToken}`,
            }, applicant.id);
            this.logger.log(`Moved applicant ${applicant.email} from batch ${nextBatch.batchNumber} to ${batch.batchNumber}`);
        }
        return { movedCount: movedApplicants.length };
    }
    async handleSendBatchNotifications(job) {
        const { batchId, templateSlug, extraVars = {} } = job.data;
        const applicants = await this.prisma.applicant.findMany({
            where: { batchId, status: { not: 'REMOVED' } },
        });
        const frontendUrl = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
        let sentCount = 0;
        for (const applicant of applicants) {
            const success = await this.emailService.sendTemplatedEmail(applicant.email, templateSlug, {
                firstName: applicant.firstName,
                lastName: applicant.lastName,
                email: applicant.email,
                statusUrl: `${frontendUrl}/applicants/status/${applicant.accessToken}`,
                ...extraVars,
            }, applicant.id);
            if (success)
                sentCount++;
        }
        this.logger.log(`Sent ${sentCount}/${applicants.length} emails for batch ${batchId}`);
        return { sentCount, total: applicants.length };
    }
};
exports.BatchProcessor = BatchProcessor;
exports.BatchProcessor = BatchProcessor = BatchProcessor_1 = __decorate([
    (0, bullmq_1.Processor)('batch-queue'),
    __metadata("design:paramtypes", [prisma_1.PrismaService,
        batch_1.BatchService,
        team_1.TeamService,
        eligibility_1.EligibilityService,
        email_1.EmailService,
        config_1.ConfigService])
], BatchProcessor);
//# sourceMappingURL=batch.processor.js.map