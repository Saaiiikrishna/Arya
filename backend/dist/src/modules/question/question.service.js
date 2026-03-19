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
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../prisma");
const client_1 = require("@prisma/client");
let QuestionService = class QuestionService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        if (dto.sortOrder === undefined) {
            const lastQuestion = await this.prisma.question.findFirst({
                orderBy: { sortOrder: 'desc' },
            });
            dto.sortOrder = (lastQuestion?.sortOrder ?? 0) + 1;
        }
        return this.prisma.question.create({ data: dto });
    }
    async findAll(phaseTag, activeOnly = true) {
        return this.prisma.question.findMany({
            where: {
                ...(phaseTag && { phaseTag }),
                ...(activeOnly && { isActive: true }),
            },
            orderBy: { sortOrder: 'asc' },
        });
    }
    async findOne(id) {
        const question = await this.prisma.question.findUnique({
            where: { id },
            include: { eligibilityCriteria: true },
        });
        if (!question)
            throw new common_1.NotFoundException('Question not found');
        return question;
    }
    async update(id, dto) {
        await this.findOne(id);
        return this.prisma.question.update({
            where: { id },
            data: dto,
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.question.update({
            where: { id },
            data: { isActive: false },
        });
    }
    async reorder(dto) {
        const updates = dto.items.map((item) => this.prisma.question.update({
            where: { id: item.id },
            data: { sortOrder: item.sortOrder },
        }));
        await this.prisma.$transaction(updates);
        return { success: true };
    }
    async getPublicQuestions(phaseTag = client_1.PhaseTag.INITIAL) {
        return this.prisma.question.findMany({
            where: { isActive: true, phaseTag },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                label: true,
                helpText: true,
                type: true,
                options: true,
                isRequired: true,
                category: true,
                validation: true,
            },
        });
    }
};
exports.QuestionService = QuestionService;
exports.QuestionService = QuestionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService])
], QuestionService);
//# sourceMappingURL=question.service.js.map