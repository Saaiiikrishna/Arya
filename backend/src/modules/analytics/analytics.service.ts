import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Batch Performance ───────────────────────────────

  async getBatchPerformance(batchId: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        teams: {
          include: {
            members: { select: { id: true, status: true } },
            sprints: {
              include: {
                milestones: true,
              },
            },
            project: true,
          },
        },
        _count: { select: { applicants: true, teams: true } },
      },
    });

    if (!batch) return null;

    const teamMetrics = batch.teams.map(team => {
      const allMilestones = team.sprints.flatMap(s => s.milestones);
      const completed = allMilestones.filter(m => m.isCompleted).length;
      const total = allMilestones.length;
      const overdue = allMilestones.filter(
        m => !m.isCompleted && new Date(m.deadline) < new Date(),
      ).length;

      let riskLevel: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
      if (total > 0) {
        const completionRate = completed / total;
        if (completionRate < 0.3 || overdue > 2) riskLevel = 'RED';
        else if (completionRate < 0.6 || overdue > 0) riskLevel = 'YELLOW';
      }

      return {
        teamId: team.id,
        teamName: team.name,
        teamType: team.teamType,
        memberCount: team.memberCount,
        totalMilestones: total,
        completedMilestones: completed,
        overdueMilestones: overdue,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        riskLevel,
        projectStatus: team.project?.status || null,
      };
    });

    // Sort by performance (worst first)
    teamMetrics.sort((a, b) => a.completionRate - b.completionRate);

    const activeMembers = batch.teams.reduce(
      (sum, t) => sum + t.members.filter(m => m.status !== 'REMOVED').length, 0,
    );
    const removedMembers = batch.teams.reduce(
      (sum, t) => sum + t.members.filter(m => m.status === 'REMOVED').length, 0,
    );

    return {
      batchNumber: batch.batchNumber,
      status: batch.status,
      totalTeams: batch.teams.length,
      activeMembers,
      removedMembers,
      dropOffRate: activeMembers + removedMembers > 0
        ? Math.round((removedMembers / (activeMembers + removedMembers)) * 100)
        : 0,
      teamMetrics,
      riskSummary: {
        green: teamMetrics.filter(t => t.riskLevel === 'GREEN').length,
        yellow: teamMetrics.filter(t => t.riskLevel === 'YELLOW').length,
        red: teamMetrics.filter(t => t.riskLevel === 'RED').length,
      },
    };
  }

  // ─── Team Rankings ───────────────────────────────────

  // Bounds for the (unbounded by default) global leaderboard query. Without a
  // batchId the dashboard would otherwise materialize every team + nested
  // sprint/milestone/member row across all batches ever created. Scope to the
  // most-recent batches and cap the number of teams considered/returned.
  private static readonly RANKINGS_RECENT_BATCHES = 3;
  private static readonly RANKINGS_TEAM_LIMIT = 100;

  async getTeamRankings(batchId?: string) {
    let batchFilter: { id: string } | { id: { in: string[] } };

    if (batchId) {
      batchFilter = { id: batchId };
    } else {
      // Scope the global leaderboard to the most-recent batch(es) so the query
      // does not grow without bound as historical batches accumulate.
      const recentBatches = await this.prisma.batch.findMany({
        orderBy: { batchNumber: 'desc' },
        take: AnalyticsService.RANKINGS_RECENT_BATCHES,
        select: { id: true },
      });
      if (recentBatches.length === 0) return [];
      batchFilter = { id: { in: recentBatches.map(b => b.id) } };
    }

    const teams = await this.prisma.team.findMany({
      where: { batch: { is: batchFilter } },
      take: AnalyticsService.RANKINGS_TEAM_LIMIT,
      orderBy: { createdAt: 'desc' },
      include: {
        // Milestone metrics depend on per-milestone dates (on-time / overdue),
        // so the rows are still needed — but they are now bounded to a capped
        // set of teams within the recent batch window.
        sprints: { select: { milestones: true } },
        // Participation only needs member status, not full member rows. Select
        // just the status column (members are bounded by team size).
        members: { select: { status: true } },
        batch: { select: { batchNumber: true } },
      },
    });

    const rankings = teams.map(team => {
      const allMilestones = team.sprints.flatMap(s => s.milestones);
      const completed = allMilestones.filter(m => m.isCompleted).length;
      const total = allMilestones.length;

      // Execution speed: on-time completions vs total
      const onTime = allMilestones.filter(
        m => m.isCompleted && m.completedAt && new Date(m.completedAt) <= new Date(m.deadline),
      ).length;

      // Participation: active members / total members
      const totalMembers = team.members.length;
      const activeCount = team.members.filter(m => m.status !== 'REMOVED').length;
      const participation = totalMembers > 0
        ? Math.round((activeCount / totalMembers) * 100) : 0;

      // Composite score
      const taskCompletion = total > 0 ? (completed / total) * 30 : 0;
      const executionSpeed = total > 0 ? (onTime / total) * 30 : 0;
      const participationScore = participation * 0.2;
      const milestoneAdherence = total > 0
        ? ((total - allMilestones.filter(m => !m.isCompleted && new Date(m.deadline) < new Date()).length) / total) * 20
        : 0;

      const score = Math.round(taskCompletion + executionSpeed + participationScore + milestoneAdherence);

      return {
        teamId: team.id,
        teamName: team.name,
        batchNumber: team.batch.batchNumber,
        score,
        taskCompletion: total > 0 ? Math.round((completed / total) * 100) : 0,
        executionSpeed: total > 0 ? Math.round((onTime / total) * 100) : 0,
        participation,
        memberCount: team.memberCount,
      };
    });

    rankings.sort((a, b) => b.score - a.score);

    return rankings.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  // ─── Overview Dashboard ──────────────────────────────

  async getOverview() {
    const [totalBatches, totalTeams, totalApplicants, statusBreakdown] = await Promise.all([
      this.prisma.batch.count(),
      this.prisma.team.count(),
      this.prisma.applicant.count(),
      this.prisma.batch.groupBy({
        by: ['status'],
        _count: true,
      }),
    ]);

    const milestoneStats = await this.prisma.milestone.aggregate({
      _count: true,
    });

    const completedMilestones = await this.prisma.milestone.count({
      where: { isCompleted: true },
    });

    return {
      totalBatches,
      totalTeams,
      totalApplicants,
      batchStatusBreakdown: statusBreakdown.map(s => ({
        status: s.status,
        count: s._count,
      })),
      milestoneOverview: {
        total: milestoneStats._count,
        completed: completedMilestones,
        completionRate: milestoneStats._count > 0
          ? Math.round((completedMilestones / milestoneStats._count) * 100)
          : 0,
      },
    };
  }

  // ─── Team Report ─────────────────────────────────────

  async getTeamReport(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        batch: true,
        members: {
          include: { matchingProfile: true },
        },
        sprints: {
          include: { milestones: { orderBy: { deadline: 'asc' } } },
        },
        project: { include: { ledger: { orderBy: { date: 'desc' } } } },
      },
    });

    if (!team) return null;

    const allMilestones = team.sprints.flatMap(s => s.milestones);
    const completed = allMilestones.filter(m => m.isCompleted);
    const overdue = allMilestones.filter(
      m => !m.isCompleted && new Date(m.deadline) < new Date(),
    );
    const upcoming = allMilestones.filter(
      m => !m.isCompleted && new Date(m.deadline) >= new Date(),
    ).slice(0, 5);

    return {
      team: {
        id: team.id,
        name: team.name,
        teamType: team.teamType,
        matchScore: team.matchScore,
        memberCount: team.memberCount,
      },
      batch: {
        batchNumber: team.batch.batchNumber,
        status: team.batch.status,
      },
      members: team.members.map(m => ({
        id: m.id,
        name: `${m.firstName} ${m.lastName}`,
        status: m.status,
        skills: (m.matchingProfile as any)?.skills || [],
      })),
      progress: {
        totalMilestones: allMilestones.length,
        completed: completed.length,
        overdue: overdue.length,
        completionRate: allMilestones.length > 0
          ? Math.round((completed.length / allMilestones.length) * 100) : 0,
      },
      upcomingMilestones: upcoming,
      project: team.project ? {
        name: team.project.projectName,
        status: team.project.status,
        fundedAmount: team.project.fundedAmount,
        estimatedFunds: team.project.estimatedFunds,
      } : null,
    };
  }
}
