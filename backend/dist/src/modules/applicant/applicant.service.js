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
var ApplicantService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicantService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../prisma");
const uuid_1 = require("uuid");
const client_1 = require("@prisma/client");
let ApplicantService = ApplicantService_1 = class ApplicantService {
    prisma;
    logger = new common_1.Logger(ApplicantService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async apply(dto) {
        const existing = await this.prisma.applicant.findUnique({
            where: { email: dto.email },
        });
        if (existing) {
            throw new common_1.ConflictException('An application with this email already exists');
        }
        let batch = await this.prisma.batch.findFirst({
            where: { status: 'FILLING' },
            orderBy: { batchNumber: 'asc' },
        });
        if (!batch) {
            const lastBatch = await this.prisma.batch.findFirst({
                orderBy: { batchNumber: 'desc' },
            });
            batch = await this.prisma.batch.create({
                data: { batchNumber: (lastBatch?.batchNumber ?? 0) + 1 },
            });
        }
        const accessToken = (0, uuid_1.v4)();
        const applicant = await this.prisma.$transaction(async (tx) => {
            const newApplicant = await tx.applicant.create({
                data: {
                    email: dto.email,
                    firstName: dto.firstName,
                    lastName: dto.lastName,
                    phone: dto.phone,
                    batchId: batch.id,
                    accessToken,
                },
            });
            if (dto.answers.length > 0) {
                await tx.answer.createMany({
                    data: dto.answers.map((a) => ({
                        applicantId: newApplicant.id,
                        questionId: a.questionId,
                        value: a.value,
                        phaseTag: client_1.PhaseTag.INITIAL,
                    })),
                });
            }
            await tx.batch.update({
                where: { id: batch.id },
                data: { currentCount: { increment: 1 } },
            });
            return newApplicant;
        });
        this.logger.log(`New applicant registered: ${dto.email} in batch ${batch.batchNumber}`);
        return {
            id: applicant.id,
            email: applicant.email,
            firstName: applicant.firstName,
            lastName: applicant.lastName,
            batchNumber: batch.batchNumber,
            accessToken: applicant.accessToken,
        };
    }
    async findByAccessToken(accessToken) {
        const applicant = await this.prisma.applicant.findUnique({
            where: { accessToken },
            include: {
                batch: { select: { batchNumber: true, status: true } },
                team: { select: { id: true, name: true } },
                answers: { include: { question: { select: { label: true, type: true } } } },
            },
        });
        if (!applicant)
            throw new common_1.NotFoundException('Applicant not found');
        return applicant;
    }
    async submitAdditionalAnswers(accessToken, dto) {
        const applicant = await this.prisma.applicant.findUnique({
            where: { accessToken },
        });
        if (!applicant)
            throw new common_1.NotFoundException('Applicant not found');
        await this.prisma.answer.createMany({
            data: dto.answers.map((a) => ({
                applicantId: applicant.id,
                questionId: a.questionId,
                value: a.value,
                phaseTag: client_1.PhaseTag.ADDITIONAL,
            })),
            skipDuplicates: true,
        });
        return { success: true };
    }
    async giveConsent(accessToken, consentDocUrl) {
        const applicant = await this.prisma.applicant.findUnique({
            where: { accessToken },
        });
        if (!applicant)
            throw new common_1.NotFoundException('Applicant not found');
        return this.prisma.applicant.update({
            where: { id: applicant.id },
            data: {
                consentGiven: true,
                consentDocUrl,
                status: client_1.ApplicantStatus.CONSENTED,
            },
        });
    }
    async findAll(params) {
        const { page = 1, limit = 20, search, status, batchId } = params;
        const skip = (page - 1) * limit;
        const where = {};
        if (status)
            where.status = status;
        if (batchId)
            where.batchId = batchId;
        if (search) {
            where.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
            ];
        }
        const [applicants, total] = await Promise.all([
            this.prisma.applicant.findMany({
                where,
                skip,
                take: limit,
                orderBy: { appliedAt: 'desc' },
                include: {
                    batch: { select: { batchNumber: true, status: true } },
                    team: { select: { id: true, name: true } },
                },
            }),
            this.prisma.applicant.count({ where }),
        ]);
        return {
            data: applicants,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findOneAdmin(id) {
        const applicant = await this.prisma.applicant.findUnique({
            where: { id },
            include: {
                batch: true,
                team: true,
                answers: {
                    include: { question: true },
                    orderBy: { answeredAt: 'asc' },
                },
                documents: true,
                notifications: { orderBy: { createdAt: 'desc' }, take: 20 },
            },
        });
        if (!applicant)
            throw new common_1.NotFoundException('Applicant not found');
        return applicant;
    }
    async removeApplicant(id) {
        const applicant = await this.prisma.applicant.findUnique({
            where: { id },
            include: { batch: true },
        });
        if (!applicant)
            throw new common_1.NotFoundException('Applicant not found');
        await this.prisma.$transaction(async (tx) => {
            await tx.applicant.update({
                where: { id },
                data: {
                    status: client_1.ApplicantStatus.REMOVED,
                    teamId: null,
                    removedAt: new Date(),
                },
            });
            if (applicant.batchId) {
                await tx.batch.update({
                    where: { id: applicant.batchId },
                    data: { currentCount: { decrement: 1 } },
                });
            }
        });
        return {
            removedApplicantId: id,
            batchId: applicant.batchId,
            message: 'Applicant removed. Backfill job will be triggered.',
        };
    }
    async getDashboardStats() {
        const [totalApplicants, pendingCount, eligibleCount, activeCount, removedCount, totalBatches, activeBatch,] = await Promise.all([
            this.prisma.applicant.count(),
            this.prisma.applicant.count({ where: { status: 'PENDING' } }),
            this.prisma.applicant.count({ where: { status: 'ELIGIBLE' } }),
            this.prisma.applicant.count({ where: { status: 'ACTIVE' } }),
            this.prisma.applicant.count({ where: { status: 'REMOVED' } }),
            this.prisma.batch.count(),
            this.prisma.batch.findFirst({
                where: { status: { not: 'PRODUCTION' } },
                orderBy: { batchNumber: 'asc' },
                include: { _count: { select: { teams: true, applicants: true } } },
            }),
        ]);
        return {
            totalApplicants,
            statusBreakdown: {
                pending: pendingCount,
                eligible: eligibleCount,
                active: activeCount,
                removed: removedCount,
            },
            totalBatches,
            activeBatch: activeBatch
                ? {
                    id: activeBatch.id,
                    batchNumber: activeBatch.batchNumber,
                    status: activeBatch.status,
                    currentCount: activeBatch.currentCount,
                    capacity: activeBatch.capacity,
                    teamCount: activeBatch._count.teams,
                }
                : null,
        };
    }
};
exports.ApplicantService = ApplicantService;
exports.ApplicantService = ApplicantService = ApplicantService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService])
], ApplicantService);
//# sourceMappingURL=applicant.service.js.map