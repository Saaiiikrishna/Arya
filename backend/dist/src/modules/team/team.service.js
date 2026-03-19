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
var TeamService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../prisma");
const client_1 = require("@prisma/client");
let TeamService = TeamService_1 = class TeamService {
    prisma;
    logger = new common_1.Logger(TeamService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async formTeams(batchId) {
        const batch = await this.prisma.batch.findUnique({
            where: { id: batchId },
        });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found');
        const minSize = batch.teamMinSize;
        const maxSize = batch.teamMaxSize;
        const applicants = await this.prisma.applicant.findMany({
            where: { batchId, status: { in: ['PENDING', 'ELIGIBLE', 'ACTIVE'] } },
            include: { answers: true },
        });
        if (applicants.length < minSize) {
            this.logger.warn(`Batch ${batch.batchNumber}: not enough applicants (${applicants.length}) for team formation`);
            return { teamsCreated: 0, message: 'Not enough applicants for team formation' };
        }
        await this.prisma.applicant.updateMany({
            where: { batchId },
            data: { teamId: null },
        });
        await this.prisma.team.deleteMany({ where: { batchId } });
        const assignments = this.balancedPartition(applicants, minSize, maxSize);
        const teams = await this.prisma.$transaction(async (tx) => {
            const createdTeams = [];
            for (const assignment of assignments) {
                const team = await tx.team.create({
                    data: {
                        batchId,
                        name: assignment.teamName,
                        memberCount: assignment.memberIds.length,
                        matchingCriteria: {
                            algorithm: 'balanced_partition',
                            minSize,
                            maxSize,
                            formedAt: new Date().toISOString(),
                        },
                    },
                });
                await tx.applicant.updateMany({
                    where: { id: { in: assignment.memberIds } },
                    data: { teamId: team.id, status: client_1.ApplicantStatus.ACTIVE },
                });
                createdTeams.push(team);
            }
            await tx.batch.update({
                where: { id: batchId },
                data: { status: 'PROCESSING' },
            });
            return createdTeams;
        });
        this.logger.log(`Batch ${batch.batchNumber}: formed ${teams.length} teams`);
        return { teamsCreated: teams.length, teams };
    }
    balancedPartition(applicants, minSize, maxSize) {
        const shuffled = [...applicants].sort(() => Math.random() - 0.5);
        const totalApplicants = shuffled.length;
        const targetSize = Math.floor((minSize + maxSize) / 2);
        let numTeams = Math.floor(totalApplicants / targetSize);
        if (numTeams === 0)
            numTeams = 1;
        const remainder = totalApplicants - numTeams * targetSize;
        if (remainder > 0 && remainder < minSize) {
        }
        const assignments = [];
        let index = 0;
        for (let i = 0; i < numTeams; i++) {
            const baseSize = Math.floor(totalApplicants / numTeams);
            const extra = i < (totalApplicants % numTeams) ? 1 : 0;
            const teamSize = Math.min(baseSize + extra, maxSize);
            const memberIds = shuffled.slice(index, index + teamSize).map((a) => a.id);
            assignments.push({
                teamName: `Team ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`,
                memberIds,
            });
            index += teamSize;
        }
        while (index < totalApplicants) {
            const smallestTeam = assignments.reduce((prev, curr) => prev.memberIds.length <= curr.memberIds.length ? prev : curr);
            if (smallestTeam.memberIds.length < maxSize) {
                smallestTeam.memberIds.push(shuffled[index].id);
            }
            index++;
        }
        return assignments;
    }
    async matchToExistingTeam(applicantId, batchId) {
        const teams = await this.prisma.team.findMany({
            where: { batchId },
            include: { _count: { select: { members: true } } },
            orderBy: { memberCount: 'asc' },
        });
        if (teams.length === 0) {
            this.logger.warn(`No teams exist for batch. Cannot match applicant.`);
            return null;
        }
        const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
        const maxSize = batch?.teamMaxSize ?? 25;
        const targetTeam = teams.find((t) => t._count.members < maxSize);
        if (!targetTeam) {
            this.logger.warn('All teams are at max capacity');
            return null;
        }
        await this.prisma.$transaction([
            this.prisma.applicant.update({
                where: { id: applicantId },
                data: { teamId: targetTeam.id, status: client_1.ApplicantStatus.ACTIVE },
            }),
            this.prisma.team.update({
                where: { id: targetTeam.id },
                data: { memberCount: { increment: 1 } },
            }),
        ]);
        this.logger.log(`Applicant ${applicantId} matched to team ${targetTeam.name}`);
        return targetTeam;
    }
    async findByBatch(batchId) {
        return this.prisma.team.findMany({
            where: { batchId },
            include: {
                members: {
                    where: { status: { not: 'REMOVED' } },
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        status: true,
                        consentGiven: true,
                    },
                },
                _count: { select: { members: true } },
            },
            orderBy: { name: 'asc' },
        });
    }
    async findOne(id) {
        const team = await this.prisma.team.findUnique({
            where: { id },
            include: {
                batch: { select: { batchNumber: true, status: true } },
                members: {
                    where: { status: { not: 'REMOVED' } },
                    include: { answers: { include: { question: true } } },
                },
            },
        });
        if (!team)
            throw new common_1.NotFoundException('Team not found');
        return team;
    }
};
exports.TeamService = TeamService;
exports.TeamService = TeamService = TeamService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService])
], TeamService);
//# sourceMappingURL=team.service.js.map