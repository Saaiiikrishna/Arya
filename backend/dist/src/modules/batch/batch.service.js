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
var BatchService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../prisma");
const client_1 = require("@prisma/client");
let BatchService = BatchService_1 = class BatchService {
    prisma;
    logger = new common_1.Logger(BatchService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll() {
        return this.prisma.batch.findMany({
            orderBy: { batchNumber: 'asc' },
            include: {
                _count: { select: { applicants: true, teams: true } },
            },
        });
    }
    async findOne(id) {
        const batch = await this.prisma.batch.findUnique({
            where: { id },
            include: {
                _count: { select: { applicants: true, teams: true } },
                teams: {
                    include: { _count: { select: { members: true } } },
                    orderBy: { name: 'asc' },
                },
                instructions: { orderBy: { sentAt: 'desc' } },
            },
        });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found');
        return batch;
    }
    async findByNumber(batchNumber) {
        const batch = await this.prisma.batch.findUnique({
            where: { batchNumber },
            include: {
                _count: { select: { applicants: true, teams: true } },
                teams: {
                    include: {
                        members: {
                            select: { id: true, firstName: true, lastName: true, email: true, status: true },
                        },
                    },
                },
            },
        });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found');
        return batch;
    }
    async checkAndCreateBatch() {
        const fillingBatch = await this.prisma.batch.findFirst({
            where: { status: 'FILLING' },
        });
        if (!fillingBatch)
            return { triggered: false };
        if (fillingBatch.currentCount >= fillingBatch.capacity) {
            await this.prisma.batch.update({
                where: { id: fillingBatch.id },
                data: { status: client_1.BatchStatus.SCREENING },
            });
            await this.prisma.batch.create({
                data: { batchNumber: fillingBatch.batchNumber + 1 },
            });
            this.logger.log(`Batch ${fillingBatch.batchNumber} filled. Moving to SCREENING.`);
            return { triggered: true, batchId: fillingBatch.id };
        }
        return { triggered: false };
    }
    async transitionStatus(id, newStatus) {
        const batch = await this.prisma.batch.findUnique({ where: { id } });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found');
        const validTransitions = {
            FILLING: [client_1.BatchStatus.SCREENING],
            SCREENING: [client_1.BatchStatus.TEAM_FORMATION],
            TEAM_FORMATION: [client_1.BatchStatus.PROCESSING],
            PROCESSING: [client_1.BatchStatus.PENDING_CONSENT],
            PENDING_CONSENT: [client_1.BatchStatus.FINALIZED],
            FINALIZED: [client_1.BatchStatus.PRODUCTION],
            PRODUCTION: [],
        };
        if (!validTransitions[batch.status]?.includes(newStatus)) {
            throw new common_1.BadRequestException(`Cannot transition from ${batch.status} to ${newStatus}`);
        }
        const updateData = { status: newStatus };
        if (newStatus === client_1.BatchStatus.FINALIZED)
            updateData.finalizedAt = new Date();
        if (newStatus === client_1.BatchStatus.PRODUCTION)
            updateData.productionAt = new Date();
        return this.prisma.batch.update({
            where: { id },
            data: updateData,
        });
    }
    async sendInstructions(batchId, title, content, additionalQuestionIds = []) {
        const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found');
        const instruction = await this.prisma.batchInstruction.create({
            data: {
                batchId,
                title,
                content,
                additionalQuestionIds,
            },
        });
        this.logger.log(`Instructions sent to batch ${batch.batchNumber}: ${title}`);
        return instruction;
    }
    async getApplicantsForBatch(batchId) {
        return this.prisma.applicant.findMany({
            where: { batchId, status: { not: 'REMOVED' } },
            include: {
                answers: { include: { question: true } },
                team: { select: { id: true, name: true } },
            },
            orderBy: { appliedAt: 'asc' },
        });
    }
    async approveBatch(id) {
        const batch = await this.prisma.batch.findUnique({
            where: { id },
            include: { _count: { select: { applicants: true } } },
        });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found');
        const unconsentedCount = await this.prisma.applicant.count({
            where: { batchId: id, status: { not: 'REMOVED' }, consentGiven: false },
        });
        if (unconsentedCount > 0) {
            throw new common_1.BadRequestException(`${unconsentedCount} applicant(s) have not given consent yet`);
        }
        await this.prisma.applicant.updateMany({
            where: { batchId: id, status: { not: 'REMOVED' } },
            data: { status: client_1.ApplicantStatus.FINALIZED },
        });
        return this.transitionStatus(id, client_1.BatchStatus.PRODUCTION);
    }
    async getPublicBatchStatus(batchNumber) {
        const batch = await this.prisma.batch.findUnique({
            where: { batchNumber },
            select: {
                batchNumber: true,
                status: true,
                capacity: true,
                currentCount: true,
                createdAt: true,
                finalizedAt: true,
                _count: { select: { teams: true } },
            },
        });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found');
        return batch;
    }
};
exports.BatchService = BatchService;
exports.BatchService = BatchService = BatchService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService])
], BatchService);
//# sourceMappingURL=batch.service.js.map