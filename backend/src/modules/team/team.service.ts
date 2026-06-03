import { Injectable, NotFoundException, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { NotificationService } from '../notifications/notification.service';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ApplicantStatus, DepartmentRole, TeamRequestStatus, SprintStatus } from '@prisma/client';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];
const RESOLVABLE_STATUSES: TeamRequestStatus[] = ['APPROVED', 'REJECTED'];

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Throws unless the caller is an admin or an active member of the team.
   * Used to gate cross-readable team-scoped reads against IDOR/PII enumeration.
   */
  private async assertTeamMembership(teamId: string, callerId: string, callerRole?: string) {
    if (ADMIN_ROLES.includes(callerRole || '')) return;
    const caller = await this.prisma.applicant.findUnique({
      where: { id: callerId },
      select: { teamId: true },
    });
    if (!caller?.teamId || caller.teamId !== teamId) {
      throw new ForbiddenException('You are not a member of this team');
    }
  }

  private isTeamRequestStatus(value: string): value is TeamRequestStatus {
    return (Object.values(TeamRequestStatus) as string[]).includes(value);
  }

  /** Validate a resolution status param (APPROVED/REJECTED) without unchecked casts. */
  private parseResolutionStatus(status: string): TeamRequestStatus {
    if (!RESOLVABLE_STATUSES.includes(status as TeamRequestStatus)) {
      throw new BadRequestException(`Status must be ${RESOLVABLE_STATUSES.join(' or ')}`);
    }
    return status as TeamRequestStatus;
  }

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

    const assignments = this.balancedPartition(applicants, minSize, maxSize);

    const teams = await this.prisma.$transaction(async (tx) => {
      // Clear existing teams inside the transaction for atomicity
      await tx.applicant.updateMany({
        where: { batchId },
        data: { teamId: null, department: null },
      });
      await tx.team.deleteMany({ where: { batchId } });

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

    // Notify every assigned member that their team was formed. Best-effort and
    // fire-after-commit: the NotificationService methods already swallow errors
    // (email + WhatsApp each member), and we never block the response on delivery.
    void this.notifyTeamsFormed(teams);

    return { teamsCreated: teams.length, teams };
  }

  /**
   * Best-effort post-commit fan-out: for each created team, load its members and
   * send the "team formed" notification. Never throws — failures are logged.
   */
  private async notifyTeamsFormed(teams: Array<{ id: string; name: string }>): Promise<void> {
    try {
      await Promise.allSettled(
        teams.map(async (team) => {
          const members = await this.prisma.applicant.findMany({
            where: { teamId: team.id },
            select: { id: true, email: true, firstName: true, phone: true },
          });
          await Promise.allSettled(
            members.map((member) => this.notifications.teamFormed(member, team.name)),
          );
        }),
      );
    } catch (e) {
      this.logger.error(`team-formed notifications failed: ${(e as any)?.message}`);
    }
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
      // Only unlocked teams are eligible to receive new members.
      this.prisma.team.findMany({
        where: { batchId, isLocked: false },
      }),
      this.prisma.batch.findUnique({ where: { id: batchId } }),
    ]);

    if (teams.length === 0) {
      this.logger.warn('No open (unlocked) teams exist for batch. Cannot match applicant.');
      return null;
    }

    const maxSize = batch?.teamMaxSize ?? 25;

    // Compute a LIVE member count per candidate team (the cached memberCount can
    // be stale), then prefer the smallest team that still has capacity.
    const candidates = await Promise.all(
      teams.map(async (t) => ({
        team: t,
        liveCount: await this.prisma.applicant.count({ where: { teamId: t.id } }),
      })),
    );
    const targetTeam = candidates
      .filter((c) => c.liveCount < maxSize)
      .sort((a, b) => a.liveCount - b.liveCount)[0]?.team;
    if (!targetTeam) {
      this.logger.warn('All open teams are at max capacity');
      return null;
    }

    // Re-check capacity against the REAL member count inside the transaction so
    // concurrent matches can't both pass the pre-read gate and over-fill the team.
    // memberCount is maintained atomically alongside the membership change but is
    // never trusted for the gate.
    await this.prisma.$transaction(async (tx) => {
      const liveCount = await tx.applicant.count({ where: { teamId: targetTeam.id } });
      if (liveCount >= maxSize) {
        throw new BadRequestException('Target team is at max capacity');
      }

      await tx.applicant.update({
        where: { id: applicantId },
        data: { teamId: targetTeam.id, status: ApplicantStatus.ACTIVE },
      });
      await tx.team.update({
        where: { id: targetTeam.id },
        data: { memberCount: { increment: 1 } },
      });
    });

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

  async getTeamDepartments(teamId: string, callerId: string, callerRole?: string) {
    await this.assertTeamMembership(teamId, callerId, callerRole);

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
    // Take the SAME per-team advisory lock the resolve path uses, so a lock can't
    // commit in the TOCTOU window of an in-flight member move (and vice-versa).
    // Read-validate-flip all happen inside the lock for Stage-2 immutability.
    const lockedTeam = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${teamId}))`;

      const team = await tx.team.findUnique({
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

      return tx.team.update({ where: { id: teamId }, data: { isLocked: true } });
    });

    // Notify all team members — non-fatal, post-commit; team is already locked in DB
    try {
      const members = await this.prisma.applicant.findMany({
        where: { teamId, status: { not: 'REMOVED' } },
        select: { id: true, email: true, firstName: true, whatsappPhone: true, whatsappVerified: true },
      });
      await Promise.allSettled([
        ...members.map((m) =>
          this.emailService.sendTemplatedEmail(
            m.email,
            'team-locked',
            { firstName: m.firstName, teamName: lockedTeam.name },
            m.id,
          ),
        ),
        ...members
          .filter((m) => m.whatsappPhone && m.whatsappVerified)
          .map((m) =>
            this.whatsappService.sendTeamLocked(m.whatsappPhone!, m.firstName, lockedTeam.name, m.id),
          ),
      ]);
    } catch (e: any) {
      this.logger.error(`Post-lock notifications failed for team ${teamId}: ${e?.message}`);
    }

    return lockedTeam;
  }

  // ─── Training lifecycle (admin) ───────────────────────────

  /**
   * Pause a team into TRAINING (post-90-day remediation): move every non-REMOVED
   * member to TRAINING, flip the current (most recent non-COMPLETED) sprint to
   * TRAINING, and stamp the team's reason + start time. Requires a reason.
   * Member notifications fire best-effort after commit and never block.
   */
  async moveToTraining(teamId: string, reason: string, adminId: string) {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestException('A reason is required to move a team to training');

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.applicant.updateMany({
        where: { teamId, status: { not: ApplicantStatus.REMOVED } },
        data: { status: ApplicantStatus.TRAINING },
      });

      // Current sprint = most recent by startDate that is not yet COMPLETED.
      const currentSprint = await tx.sprint.findFirst({
        where: { teamId, status: { not: SprintStatus.COMPLETED } },
        orderBy: { startDate: 'desc' },
      });
      if (currentSprint) {
        await tx.sprint.update({
          where: { id: currentSprint.id },
          data: { status: SprintStatus.TRAINING },
        });
      }

      await tx.team.update({
        where: { id: teamId },
        data: { trainingReason: trimmed, trainingStartedAt: new Date() },
      });
    });

    this.logger.log(`Team ${teamId} moved to TRAINING by admin ${adminId}`);

    // Best-effort, non-blocking fan-out after commit.
    void this.notifyTeamTraining(teamId, trimmed);

    return { teamId, status: 'TRAINING', reason: trimmed };
  }

  /**
   * Best-effort post-commit fan-out: notify every (now-TRAINING) member that
   * their team was paused. Never throws — failures are logged.
   */
  private async notifyTeamTraining(teamId: string, reason: string): Promise<void> {
    try {
      const members = await this.prisma.applicant.findMany({
        where: { teamId, status: ApplicantStatus.TRAINING },
        select: { id: true, email: true, firstName: true, phone: true },
      });
      await Promise.allSettled(
        members.map((member) => this.notifications.teamTraining(member, reason)),
      );
    } catch (e) {
      this.logger.error(`team-training notifications failed: ${(e as any)?.message}`);
    }
  }

  /**
   * Reactivate a team out of TRAINING: restore members from TRAINING to ACTIVE,
   * flip the TRAINING sprint back to ON_TRACK, and clear the team's training note.
   */
  async reactivateFromTraining(teamId: string, adminId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.applicant.updateMany({
        where: { teamId, status: ApplicantStatus.TRAINING },
        data: { status: ApplicantStatus.ACTIVE },
      });

      await tx.sprint.updateMany({
        where: { teamId, status: SprintStatus.TRAINING },
        data: { status: SprintStatus.ON_TRACK },
      });

      await tx.team.update({
        where: { id: teamId },
        data: { trainingReason: null, trainingStartedAt: null },
      });
    });

    this.logger.log(`Team ${teamId} reactivated from TRAINING by admin ${adminId}`);

    return { teamId, status: 'ACTIVE' };
  }

  /**
   * Remove a team: mark every non-REMOVED member REMOVED (stamp removedAt) and
   * decrement the batch's currentCount by the number actually removed, clamped
   * so the count can never go negative.
   */
  async removeTeam(teamId: string, adminId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    const removedCount = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.applicant.updateMany({
        where: { teamId, status: { not: ApplicantStatus.REMOVED } },
        data: { status: ApplicantStatus.REMOVED, removedAt: new Date() },
      });

      if (count > 0) {
        const batch = await tx.batch.findUnique({
          where: { id: team.batchId },
          select: { currentCount: true },
        });
        if (batch) {
          const decrement = Math.min(count, batch.currentCount);
          if (decrement > 0) {
            await tx.batch.update({
              where: { id: team.batchId },
              data: { currentCount: { decrement } },
            });
          }
        }
      }

      return count;
    });

    this.logger.log(`Team ${teamId} removed (${removedCount} members) by admin ${adminId}`);

    return { teamId, removedCount };
  }

  // ─── Team Requests ────────────────────────────────────────

  async createTeamRequest(
    teamId: string,
    requesterId: string,
    body: { type: string; title: string; details: string; targetTeamId?: string },
  ) {
    const ALLOWED_TYPES = ['SWAP', 'RESOURCE', 'COMPLAINT', 'SEPARATION', 'JOIN_EXISTING', 'CREATE_NEW'];
    if (!ALLOWED_TYPES.includes(body.type)) {
      throw new BadRequestException(`Invalid request type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
    }

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

    const CHANGE_TYPES = ['SEPARATION', 'JOIN_EXISTING', 'CREATE_NEW'];
    const requiresMentor = CHANGE_TYPES.includes(body.type);

    if (team.isLocked && requiresMentor) {
      throw new BadRequestException('Team membership changes are not permitted after the team is locked');
    }

    return this.prisma.teamRequest.create({
      data: {
        teamId,
        requesterId,
        type: body.type as any,
        title: body.title,
        details: body.details,
        targetTeamId: body.targetTeamId ?? null,
        mentorStatus: requiresMentor ? 'PENDING' : null,
      } as any,
    });
  }

  async getTeamRequests(teamId: string, callerId: string, callerRole?: string, status?: string) {
    await this.assertTeamMembership(teamId, callerId, callerRole);

    const where: any = { teamId };
    if (status) {
      if (!this.isTeamRequestStatus(status)) {
        throw new BadRequestException(
          `Invalid status filter. Allowed: ${Object.values(TeamRequestStatus).join(', ')}`,
        );
      }
      where.status = status;
    }

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
    const resolution = this.parseResolutionStatus(status);

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
      data: { status: resolution, resolvedById: resolverId, resolvedAt: new Date() },
    });
  }

  /**
   * Admin resolution for team change requests.
   * On approval of SEPARATION or JOIN_EXISTING, physically moves the member.
   */
  async adminResolveTeamRequest(reqId: string, adminId: string, status: string) {
    const resolution = this.parseResolutionStatus(status);

    const request = await this.prisma.teamRequest.findUnique({ where: { id: reqId } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Request has already been resolved');

    const CHANGE_TYPES = ['SEPARATION', 'JOIN_EXISTING', 'CREATE_NEW'];
    const isMembershipChange = CHANGE_TYPES.includes(request.type);

    // Stage-2 immutability guard (a): mentor approval is mandatory before an admin
    // may APPROVE a membership-changing request. (Rejection is still allowed without
    // mentor approval so admins can clear bad/stale requests.)
    if (isMembershipChange && resolution === 'APPROVED' && (request as any).mentorStatus !== 'APPROVED') {
      throw new BadRequestException('Mentor approval is required before admin can approve this request');
    }

    if (resolution === 'APPROVED') {
      return await this.prisma.$transaction(async (tx) => {
        // Stage-2 immutability guard (b): once a team isLocked, its membership is
        // frozen. Serialize against concurrent lockTeam / membership moves with a
        // team-scoped advisory lock, then re-read the source team's lock state
        // inside the transaction so a lock that lands after the pre-read still wins.
        if (isMembershipChange) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.teamId}))`;
          const sourceLockState = await tx.team.findUnique({
            where: { id: request.teamId },
            select: { isLocked: true },
          });
          if (!sourceLockState) throw new NotFoundException('Source team not found');
          if (sourceLockState.isLocked) {
            throw new ForbiddenException(
              'Team membership changes are not permitted after the team is locked',
            );
          }
        }

        // Claim the request atomically BEFORE mutating membership, so two admins
        // can't both pass the PENDING pre-check and double-apply (double decrement
        // / double join). Only the caller whose CAS flips PENDING -> resolution wins;
        // the status stamp and the membership mutation now commit together.
        const claimed = await tx.teamRequest.updateMany({
          where: { id: reqId, status: 'PENDING' },
          data: { status: resolution, resolvedById: adminId, resolvedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException('Request has already been resolved');
        }

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

          const [targetTeam, sourceTeam] = await Promise.all([
            tx.team.findUnique({
              where: { id: request.targetTeamId },
              // Count only ACTIVE members (exclude REMOVED) for the capacity gate.
              include: { _count: { select: { members: { where: { status: { not: 'REMOVED' } } } } } },
            }),
            tx.team.findUnique({ where: { id: request.teamId } }),
          ]);

          if (!sourceTeam) throw new NotFoundException('Source team not found');
          const batchData = await tx.batch.findUnique({ where: { id: sourceTeam.batchId } });
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

        return tx.teamRequest.findUnique({ where: { id: reqId } });
      });
    }

    return this.prisma.teamRequest.update({
      where: { id: reqId },
      data: { status: resolution, resolvedById: adminId, resolvedAt: new Date() },
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

  // ─── Founder: Resource Requests ───────────────────────────

  async submitResourceRequest(teamId: string, callerId: string, dto: { type: string; description: string }) {
    const applicant = await this.prisma.applicant.findUnique({ where: { id: callerId } });
    if (!applicant || applicant.teamId !== teamId) throw new ForbiddenException('You are not in this team');

    const assignment = await (this.prisma as any).coFounderAssignment.findFirst({
      where: { teamId, isActive: true },
    });
    if (!assignment) throw new BadRequestException('No co-founder is assigned to your team yet — resource requests will be available once your co-founder is assigned');

    return (this.prisma as any).resourceRequest.create({
      data: {
        coFounderId: assignment.coFounderId,
        teamId,
        type: dto.type || 'OTHER',
        description: dto.description,
      },
    });
  }

  async getTeamResourceRequests(teamId: string, callerId: string, status?: string) {
    const applicant = await this.prisma.applicant.findUnique({ where: { id: callerId } });
    if (!applicant || applicant.teamId !== teamId) throw new ForbiddenException('You are not in this team');

    const where: any = { teamId };
    if (status) where.status = status;
    return (this.prisma as any).resourceRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
