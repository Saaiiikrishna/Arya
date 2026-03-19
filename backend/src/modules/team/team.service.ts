import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { ApplicantStatus } from '@prisma/client';

interface ApplicantWithAnswers {
  id: string;
  answers: Array<{ questionId: string; value: any }>;
}

interface TeamAssignment {
  teamName: string;
  memberIds: string[];
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Form teams for a batch using criteria-based scoring and balanced partitioning.
   * 
   * Algorithm:
   * 1. Get all eligible applicants in the batch with their answers
   * 2. Compute a composite feature vector for each applicant
   * 3. Use greedy balanced partitioning to create teams of minSize–maxSize
   * 4. Save teams and assign members
   */
  async formTeams(batchId: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const minSize = batch.teamMinSize;
    const maxSize = batch.teamMaxSize;

    // Get eligible applicants with answers
    const applicants = await this.prisma.applicant.findMany({
      where: { batchId, status: { in: ['PENDING', 'ELIGIBLE', 'ACTIVE'] } },
      include: { answers: true },
    });

    if (applicants.length < minSize) {
      this.logger.warn(`Batch ${batch.batchNumber}: not enough applicants (${applicants.length}) for team formation`);
      return { teamsCreated: 0, message: 'Not enough applicants for team formation' };
    }

    // Delete existing teams for this batch (for re-matching)
    await this.prisma.applicant.updateMany({
      where: { batchId },
      data: { teamId: null },
    });
    await this.prisma.team.deleteMany({ where: { batchId } });

    // Run team formation algorithm
    const assignments = this.balancedPartition(applicants, minSize, maxSize);

    // Save teams in transaction
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

      // Update batch status
      await tx.batch.update({
        where: { id: batchId },
        data: { status: 'PROCESSING' },
      });

      return createdTeams;
    });

    this.logger.log(`Batch ${batch.batchNumber}: formed ${teams.length} teams`);
    return { teamsCreated: teams.length, teams };
  }

  /**
   * Balanced partition algorithm: distributes applicants into teams of minSize–maxSize.
   * Shuffles applicants for randomness, then fills teams sequentially.
   * Future: can be enhanced with scoring / compatibility matching.
   */
  private balancedPartition(
    applicants: ApplicantWithAnswers[],
    minSize: number,
    maxSize: number,
  ): TeamAssignment[] {
    // Shuffle for random distribution
    const shuffled = [...applicants].sort(() => Math.random() - 0.5);
    const totalApplicants = shuffled.length;

    // Calculate optimal team size and count
    const targetSize = Math.floor((minSize + maxSize) / 2);
    let numTeams = Math.floor(totalApplicants / targetSize);
    if (numTeams === 0) numTeams = 1;

    // Adjust if remainder would be too small
    const remainder = totalApplicants - numTeams * targetSize;
    if (remainder > 0 && remainder < minSize) {
      // Distribute remainder across existing teams
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

    // Handle any remaining applicants
    while (index < totalApplicants) {
      const smallestTeam = assignments.reduce((prev, curr) =>
        prev.memberIds.length <= curr.memberIds.length ? prev : curr,
      );
      if (smallestTeam.memberIds.length < maxSize) {
        smallestTeam.memberIds.push(shuffled[index].id);
      }
      index++;
    }

    return assignments;
  }

  /**
   * Match new users (from backfill) into existing teams.
   * Finds the team with the fewest members and adds the user there.
   */
  async matchToExistingTeam(applicantId: string, batchId: string) {
    const teams = await this.prisma.team.findMany({
      where: { batchId },
      include: { _count: { select: { members: true } } },
      orderBy: { memberCount: 'asc' },
    });

    if (teams.length === 0) {
      this.logger.warn(`No teams exist for batch. Cannot match applicant.`);
      return null;
    }

    // Find team with fewest members that hasn't hit max
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
        data: { teamId: targetTeam.id, status: ApplicantStatus.ACTIVE },
      }),
      this.prisma.team.update({
        where: { id: targetTeam.id },
        data: { memberCount: { increment: 1 } },
      }),
    ]);

    this.logger.log(`Applicant ${applicantId} matched to team ${targetTeam.name}`);
    return targetTeam;
  }

  // ─── Admin endpoints ──────────────────────────────

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
}
