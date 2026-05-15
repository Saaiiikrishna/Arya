import { Injectable, NotFoundException, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { ApplicantStatus, DepartmentRole } from '@prisma/client';

interface ApplicantWithAnswers {
  id: string;
  answers: Array<{ questionId: string; value: any }>;
}

interface TeamAssignment {
  teamName: string;
  memberIds: string[];
}

const ALL_DEPARTMENTS: DepartmentRole[] = [
  'PRODUCT',
  'OPERATIONS',
  'RESOURCES',
  'SALES_MARKETING',
  'FOUNDING_OTHER',
];

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Form teams for a batch using criteria-based scoring and balanced partitioning.
   */
  async formTeams(batchId: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

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

    // Clear existing teams
    await this.prisma.applicant.updateMany({
      where: { batchId },
      data: { teamId: null, department: null },
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
          data: { teamId: team.id, status: ApplicantStatus.ACTIVE },
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

  private balancedPartition(
    applicants: ApplicantWithAnswers[],
    minSize: number,
    maxSize: number,
  ): TeamAssignment[] {
    const shuffled = [...applicants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const totalApplicants = shuffled.length;

    const targetSize = Math.floor((minSize + maxSize) / 2);
    let numTeams = Math.max(1, Math.floor(totalApplicants / targetSize));

    const remainder = totalApplicants - numTeams * targetSize;
    if (remainder > 0 && remainder < minSize && numTeams > 1) {
      numTeams -= 1;
    }

    const assignments: TeamAssignment[] = [];
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
      const smallestTeam = assignments.reduce((prev, curr) =>
        prev.memberIds.length <= curr.memberIds.length ? prev : curr,
      );
      smallestTeam.memberIds.push(shuffled[index].id);
      index++;
    }

    return assignments;
  }

  async matchToExistingTeam(applicantId: string, batchId: string) {
    const [teams, batch] = await Promise.all([
      this.prisma.team.findMany({
        where: { batchId },
        include: { _count: { select: { members: true } } },
      }),
      this.prisma.batch.findUnique({ where: { id: batchId } }),
    ]);

    if (teams.length === 0) {
      this.logger.warn('No teams exist for batch. Cannot match applicant.');
      return null;
    }

    const maxSize = batch?.teamMaxSize ?? 25;
    const sorted = teams.sort((a, b) => a._count.members - b._count.members);
    const targetTeam = sorted.find((t) => t._count.members < maxSize);
    if (!targetTeam) {
      this.logger.warn('All teams are at max capacity');
      return null;
    }

    const newCount = targetTeam._count.members + 1;
    await this.prisma.$transaction([
      this.prisma.applicant.update({
        where: { id: applicantId },
        data: { teamId: targetTeam.id, status: ApplicantStatus.ACTIVE },
      }),
      this.prisma.team.update({
        where: { id: targetTeam.id },
        data: { memberCount: newCount },
      }),
    ]);

    this.logger.log(`Applicant ${applicantId} matched to team ${targetTeam.name}`);
    return targetTeam;
  }

  // ─── Admin endpoints ──────────────────────────────────────

  async findByBatch(batchId: string) {
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
            department: true,
            consentGiven: true,
          },
        },
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
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
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  // ─── Department management ────────────────────────────────

  async getTeamDepartments(teamId: string) {
    const members = await this.prisma.applicant.findMany({
      where: { teamId, status: { not: 'REMOVED' } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, department: true },
    });

    const slots = ALL_DEPARTMENTS.map((dept) => ({
      department: dept,
      member: members.find((m) => m.department === dept) ?? null,
    }));

    const filled = slots.filter((s) => s.member !== null).length;

    return {
      slots,
      filledCount: filled,
      totalRequired: ALL_DEPARTMENTS.length,
      isComplete: filled === ALL_DEPARTMENTS.length,
    };
  }

  async setMemberDepartment(teamId: string, applicantId: string, callerId: string, department: DepartmentRole) {
    // Only the member themselves can claim a dept slot
    if (applicantId !== callerId) throw new ForbiddenException('You can only set your own department');

    const applicant = await this.prisma.applicant.findUnique({ where: { id: applicantId } });
    if (!applicant || applicant.teamId !== teamId) throw new ForbiddenException('You are not in this team');

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');
    if (team.isLocked) throw new BadRequestException('Team is locked — departments cannot be changed');

    // Ensure the dept slot is not already taken by another member
    const existing = await this.prisma.applicant.findFirst({
      where: { teamId, department, id: { not: applicantId } },
    });
    if (existing) {
      throw new BadRequestException(
        `${department} is already claimed by ${existing.firstName} ${existing.lastName}`,
      );
    }

    return this.prisma.applicant.update({
      where: { id: applicantId },
      data: { department },
      select: { id: true, firstName: true, lastName: true, department: true },
    });
  }

  async lockTeam(teamId: string, adminId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: { where: { status: { not: 'REMOVED' } } } },
    });
    if (!team) throw new NotFoundException('Team not found');
    if (team.isLocked) throw new BadRequestException('Team is already locked');

    // Validate all 5 departments are filled
    const filledDepts = new Set(
      team.members.map((m) => m.department).filter(Boolean),
    );
    const missing = ALL_DEPARTMENTS.filter((d) => !filledDepts.has(d));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot lock team: missing department roles: ${missing.join(', ')}`,
      );
    }

    return this.prisma.team.update({
      where: { id: teamId },
      data: { isLocked: true },
    });
  }

  // ─── Team Requests ────────────────────────────────────────

  async createTeamRequest(
    teamId: string,
    requesterId: string,
    body: { type: string; title: string; details: string; targetTeamId?: string },
  ) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    const requester = await this.prisma.applicant.findUnique({ where: { id: requesterId } });
    if (!requester || requester.teamId !== teamId) throw new ForbiddenException('You are not in this team');

    if (body.type === 'JOIN_EXISTING' && !body.targetTeamId) {
      throw new BadRequestException('targetTeamId is required for JOIN_EXISTING requests');
    }

    if (body.targetTeamId) {
      const targetTeam = await this.prisma.team.findUnique({ where: { id: body.targetTeamId } });
      if (!targetTeam || targetTeam.batchId !== team.batchId) {
        throw new BadRequestException('Target team not found in this batch');
      }
    }

    return this.prisma.teamRequest.create({
      data: {
        teamId,
        requesterId,
        type: body.type as any,
        title: body.title,
        details: body.details,
        targetTeamId: body.targetTeamId ?? null,
      },
    });
  }

  async getTeamRequests(teamId: string, status?: string) {
    const where: any = { teamId };
    if (status) where.status = status;

    const requests = await this.prisma.teamRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const requesterIds = [...new Set(requests.map((r) => r.requesterId))] as string[];
    const applicants = await this.prisma.applicant.findMany({
      where: { id: { in: requesterIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    const applicantMap = new Map(applicants.map((a) => [a.id, a]));

    return requests.map((r) => ({ ...r, requester: applicantMap.get(r.requesterId) ?? null }));
  }

  async resolveTeamRequest(teamId: string, reqId: string, resolverId: string, status: string) {
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      throw new BadRequestException('Status must be APPROVED or REJECTED');
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    // Standard requests (SWAP/RESOURCE/COMPLAINT) resolved by team leader
    if (team.leaderId !== resolverId) {
      throw new ForbiddenException('Only the team leader can resolve requests');
    }

    const request = await this.prisma.teamRequest.findUnique({ where: { id: reqId } });
    if (!request || request.teamId !== teamId) throw new NotFoundException('Request not found');

    // Change-type requests should go through the admin endpoint
    if (['SEPARATION', 'JOIN_EXISTING', 'CREATE_NEW'].includes(request.type)) {
      throw new ForbiddenException('Team change requests must be resolved by an admin');
    }

    return this.prisma.teamRequest.update({
      where: { id: reqId },
      data: { status: status as any, resolvedById: resolverId, resolvedAt: new Date() },
    });
  }

  /**
   * Admin resolution for team change requests.
   * On approval of SEPARATION or JOIN_EXISTING, physically moves the member.
   */
  async adminResolveTeamRequest(reqId: string, adminId: string, status: string) {
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      throw new BadRequestException('Status must be APPROVED or REJECTED');
    }

    const request = await this.prisma.teamRequest.findUnique({ where: { id: reqId } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Request has already been resolved');

    if (status === 'APPROVED') {
      await this.prisma.$transaction(async (tx) => {
        if (request.type === 'SEPARATION') {
          // Remove from current team
          const member = await tx.applicant.findUnique({ where: { id: request.requesterId } });
          if (member?.teamId) {
            await tx.team.update({
              where: { id: member.teamId },
              data: { memberCount: { decrement: 1 } },
            });
          }
          await tx.applicant.update({
            where: { id: request.requesterId },
            data: { teamId: null, department: null },
          });
        } else if (request.type === 'JOIN_EXISTING') {
          if (!request.targetTeamId) throw new BadRequestException('No target team specified');

          const [targetTeam, batch] = await Promise.all([
            tx.team.findUnique({
              where: { id: request.targetTeamId },
              include: { _count: { select: { members: true } } },
            }),
            tx.batch.findUnique({ where: { id: request.teamId } }), // batch lookup via teamId indirectly
          ]);

          // Get the team's batch for maxSize
          const sourceTeam = await tx.team.findUnique({ where: { id: request.teamId } });
          const batchData = await tx.batch.findUnique({ where: { id: sourceTeam!.batchId } });
          const maxSize = batchData?.teamMaxSize ?? 25;

          if (!targetTeam) throw new NotFoundException('Target team not found');
          if (targetTeam._count.members >= maxSize) {
            throw new BadRequestException('Target team is at max capacity');
          }
          if (targetTeam.isLocked) {
            throw new BadRequestException('Target team is locked and cannot accept new members');
          }

          // Remove from old team, add to new team
          const member = await tx.applicant.findUnique({ where: { id: request.requesterId } });
          if (member?.teamId) {
            await tx.team.update({
              where: { id: member.teamId },
              data: { memberCount: { decrement: 1 } },
            });
          }
          await tx.applicant.update({
            where: { id: request.requesterId },
            data: { teamId: request.targetTeamId, department: null },
          });
          await tx.team.update({
            where: { id: request.targetTeamId },
            data: { memberCount: { increment: 1 } },
          });
        }
        // CREATE_NEW is handled manually by admins (requires 5 members + all depts)
      });
    }

    return this.prisma.teamRequest.update({
      where: { id: reqId },
      data: { status: status as any, resolvedById: adminId, resolvedAt: new Date() },
    });
  }

  // ─── Leader: Edit Project ──────────────────────────────────

  async updateProjectAsLeader(teamId: string, callerId: string, body: any) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { project: true },
    });
    if (!team) throw new NotFoundException('Team not found');
    if (team.leaderId !== callerId) {
      throw new ForbiddenException('Only the team leader can edit project details');
    }

    if (team.project) {
      return this.prisma.project.update({
        where: { id: team.project.id },
        data: {
          ...(body.projectName && { projectName: body.projectName }),
          ...(body.targetMarket && { targetMarket: body.targetMarket }),
          ...(body.description && { description: body.description }),
          ...(body.estimatedFunds !== undefined && { estimatedFunds: body.estimatedFunds }),
        },
      });
    } else {
      return this.prisma.project.create({
        data: {
          teamId,
          projectName: body.projectName || 'Untitled Project',
          targetMarket: body.targetMarket || 'TBD',
          description: body.description || '',
          estimatedFunds: body.estimatedFunds || 0,
        },
      });
    }
  }
}
