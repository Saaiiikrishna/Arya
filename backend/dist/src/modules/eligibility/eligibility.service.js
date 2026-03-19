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
var EligibilityService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EligibilityService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../prisma");
let EligibilityService = EligibilityService_1 = class EligibilityService {
    prisma;
    logger = new common_1.Logger(EligibilityService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createCriteria(data) {
        return this.prisma.eligibilityCriteria.create({ data });
    }
    async findAll() {
        return this.prisma.eligibilityCriteria.findMany({
            where: { isActive: true },
            include: { question: { select: { label: true, type: true } } },
            orderBy: { createdAt: 'asc' },
        });
    }
    async update(id, data) {
        return this.prisma.eligibilityCriteria.update({ where: { id }, data });
    }
    async remove(id) {
        return this.prisma.eligibilityCriteria.update({
            where: { id },
            data: { isActive: false },
        });
    }
    async evaluateApplicant(applicantId) {
        const criteria = await this.prisma.eligibilityCriteria.findMany({
            where: { isActive: true },
            include: { question: true },
        });
        const answers = await this.prisma.answer.findMany({
            where: { applicantId },
        });
        const answerMap = new Map(answers.map((a) => [a.questionId, a.value]));
        const results = [];
        let eligible = true;
        for (const criterion of criteria) {
            const answer = answerMap.get(criterion.questionId);
            const passed = this.evaluateCriterion(answer, criterion.operator, criterion.value);
            if (!passed)
                eligible = false;
            results.push({
                criteriaId: criterion.id,
                passed,
                reason: passed
                    ? `Passed: ${criterion.question.label}`
                    : `Failed: ${criterion.question.label} (${criterion.operator} ${JSON.stringify(criterion.value)})`,
            });
        }
        return { eligible, results };
    }
    evaluateCriterion(answer, operator, expected) {
        if (answer === undefined || answer === null)
            return false;
        const val = typeof answer === 'object' && answer !== null ? answer : answer;
        switch (operator) {
            case 'EQ':
                return val === expected;
            case 'NEQ':
                return val !== expected;
            case 'GT':
                return Number(val) > Number(expected);
            case 'LT':
                return Number(val) < Number(expected);
            case 'GTE':
                return Number(val) >= Number(expected);
            case 'LTE':
                return Number(val) <= Number(expected);
            case 'IN':
                return Array.isArray(expected) ? expected.includes(val) : false;
            case 'NOT_IN':
                return Array.isArray(expected) ? !expected.includes(val) : true;
            case 'CONTAINS':
                return typeof val === 'string' ? val.includes(String(expected)) : false;
            case 'NOT_CONTAINS':
                return typeof val === 'string' ? !val.includes(String(expected)) : true;
            default:
                return false;
        }
    }
    async screenBatch(batchId) {
        const applicants = await this.prisma.applicant.findMany({
            where: { batchId, status: 'PENDING' },
        });
        let eligibleCount = 0;
        let ineligibleCount = 0;
        for (const applicant of applicants) {
            const { eligible } = await this.evaluateApplicant(applicant.id);
            await this.prisma.applicant.update({
                where: { id: applicant.id },
                data: { status: eligible ? 'ELIGIBLE' : 'INELIGIBLE' },
            });
            if (eligible)
                eligibleCount++;
            else
                ineligibleCount++;
        }
        this.logger.log(`Batch screening: ${eligibleCount} eligible, ${ineligibleCount} ineligible`);
        return { eligibleCount, ineligibleCount, total: applicants.length };
    }
};
exports.EligibilityService = EligibilityService;
exports.EligibilityService = EligibilityService = EligibilityService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService])
], EligibilityService);
//# sourceMappingURL=eligibility.service.js.map