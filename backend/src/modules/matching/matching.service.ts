import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { IdeaCategory, CommitmentLevel, TeamType } from '@prisma/client';

// ─── Types ─────────────────────────────────────────────

interface ApplicantProfile {
  id: string;
  firstName: string;
  lastName: string;
  matchingProfile: {
    ideaCategory: IdeaCategory | null;
    hasIdea: boolean;
    skills: string[];
    commitmentLevel: CommitmentLevel;
    hoursPerDay: number | null;
    personalityScores: PersonalityScores | null;
    experienceYears: number | null;
  } | null;
}

interface PersonalityScores {
  leadership: number;
  execution: number;
  creativity: number;
  analytical: number;
}

export interface TeamAssignment {
  teamName: string;
  teamType: TeamType;
  ideaCategory: IdeaCategory | null;
  memberIds: string[];
  matchScore: number;
}

interface MatchingConfig {
  weights: {
    ideaCategory: number;
    skillDiversity: number;
    commitmentLevel: number;
    personality: number;
    experience: number;
  };
  minTeamSize: number;
  maxTeamSize: number;
}

const DEFAULT_CONFIG: MatchingConfig = {
  weights: {
    ideaCategory: 0.30,
    skillDiversity: 0.25,
    commitmentLevel: 0.20,
    personality: 0.15,
    experience: 0.10,
  },
  minTeamSize: 5,
  maxTeamSize: 25,
};

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Core: Smart Team Formation ──────────────────────

  async smartMatch(batchId: string, configOverride?: Partial<MatchingConfig>) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const config: MatchingConfig = {
      ...DEFAULT_CONFIG,
      minTeamSize: batch.teamMinSize,
      maxTeamSize: batch.teamMaxSize,
      ...configOverride,
      weights: { ...DEFAULT_CONFIG.weights, ...configOverride?.weights },
    };

    // Fetch eligible applicants with matching profiles
    const applicants = await this.prisma.applicant.findMany({
      where: {
        batchId,
        status: { in: ['PENDING', 'ELIGIBLE', 'ACTIVE', 'CONSENTED'] },
      },
      include: { matchingProfile: true },
    }) as unknown as ApplicantProfile[];

    if (applicants.length < config.minTeamSize) {
      return {
        teamsCreated: 0,
        message: `Not enough applicants (${applicants.length}) for team formation (min: ${config.minTeamSize})`,
      };
    }

    // Separate into idea-holders and builder pool
    const ideaHolders = applicants.filter(a => a.matchingProfile?.hasIdea);
    const builderPool = applicants.filter(a => !a.matchingProfile?.hasIdea);

    this.logger.log(`Smart matching: ${ideaHolders.length} with ideas, ${builderPool.length} builder pool`);

    const assignments: TeamAssignment[] = [];

    // ── Step 1: Form idea-based teams ───────────────────
    if (ideaHolders.length > 0) {
      const ideaGroups = this.groupByIdeaCategory(ideaHolders);

      for (const [category, members] of Object.entries(ideaGroups)) {
        if (members.length >= config.minTeamSize) {
          // Enough for standalone team(s)
          const teams = this.formTeamsFromGroup(
            members,
            config,
            TeamType.IDEA_BASED,
            category as IdeaCategory,
            assignments.length,
          );
          assignments.push(...teams);
        } else {
          // Too few — move to builder pool
          builderPool.push(...members);
        }
      }
    }

    // ── Step 2: Form builder pool teams ─────────────────
    if (builderPool.length >= config.minTeamSize) {
      const teams = this.formDiverseTeams(builderPool, config, assignments.length);
      assignments.push(...teams);
    } else if (builderPool.length > 0) {
      // Distribute remaining into existing teams
      this.distributeRemainder(builderPool, assignments, config.maxTeamSize);
    }

    return { assignments, totalTeams: assignments.length };
  }

  // ─── Preview (dry run, doesn't save) ─────────────────

  async previewMatch(batchId: string, configOverride?: Partial<MatchingConfig>) {
    return this.smartMatch(batchId, configOverride);
  }

  // ─── Execute (saves to DB) ───────────────────────────

  async executeMatch(batchId: string, configOverride?: Partial<MatchingConfig>) {
    const result = await this.smartMatch(batchId, configOverride);

    if (!result.assignments || result.assignments.length === 0) {
      return { teamsCreated: 0, message: result.message || 'No teams formed' };
    }

    // Clear existing teams
    await this.prisma.applicant.updateMany({
      where: { batchId },
      data: { teamId: null },
    });
    await this.prisma.team.deleteMany({ where: { batchId } });

    // Save in transaction
    const teams = await this.prisma.$transaction(async (tx) => {
      const created = [];

      for (const assignment of result.assignments!) {
        const team = await tx.team.create({
          data: {
            batchId,
            name: assignment.teamName,
            teamType: assignment.teamType,
            ideaCategory: assignment.ideaCategory,
            memberCount: assignment.memberIds.length,
            matchScore: assignment.matchScore,
            matchingCriteria: {
              algorithm: 'smart_match_v1',
              teamType: assignment.teamType,
              ideaCategory: assignment.ideaCategory,
              matchScore: assignment.matchScore,
              formedAt: new Date().toISOString(),
            },
          },
        });

        await tx.applicant.updateMany({
          where: { id: { in: assignment.memberIds } },
          data: { teamId: team.id, status: 'ACTIVE' },
        });

        created.push({ ...team, memberCount: assignment.memberIds.length });
      }

      await tx.batch.update({
        where: { id: batchId },
        data: { status: 'PROCESSING' },
      });

      return created;
    });

    this.logger.log(`Smart match executed: ${teams.length} teams created for batch ${batchId}`);
    return { teamsCreated: teams.length, teams };
  }

  // ─── Move member between teams ───────────────────────

  async moveMember(applicantId: string, targetTeamId: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: applicantId },
      include: { team: true },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');

    const targetTeam = await this.prisma.team.findUnique({
      where: { id: targetTeamId },
      include: { batch: true },
    });
    if (!targetTeam) throw new NotFoundException('Target team not found');

    if (targetTeam.memberCount >= targetTeam.batch.teamMaxSize) {
      throw new BadRequestException('Target team is at maximum capacity');
    }

    await this.prisma.$transaction([
      // Remove from old team
      ...(applicant.teamId
        ? [
            this.prisma.team.update({
              where: { id: applicant.teamId },
              data: { memberCount: { decrement: 1 } },
            }),
          ]
        : []),
      // Add to new team
      this.prisma.applicant.update({
        where: { id: applicantId },
        data: { teamId: targetTeamId },
      }),
      this.prisma.team.update({
        where: { id: targetTeamId },
        data: { memberCount: { increment: 1 } },
      }),
    ]);

    return { success: true, applicantId, targetTeamId };
  }

  // ─── Matching Profile CRUD ───────────────────────────

  async upsertProfile(applicantId: string, data: {
    ideaCategory?: IdeaCategory;
    hasIdea?: boolean;
    ideaSummary?: string;
    skills?: string[];
    commitmentLevel?: CommitmentLevel;
    hoursPerDay?: number;
    personalityScores?: PersonalityScores;
    experienceYears?: number;
  }) {
    return this.prisma.matchingProfile.upsert({
      where: { applicantId },
      create: {
        applicantId,
        ...data,
        skills: (data.skills || []) as any,
        personalityScores: data.personalityScores as any,
      },
      update: {
        ...data,
        skills: data.skills ? (data.skills as any) : undefined,
        personalityScores: data.personalityScores ? (data.personalityScores as any) : undefined,
      },
    });
  }

  async getProfile(applicantId: string) {
    return this.prisma.matchingProfile.findUnique({
      where: { applicantId },
      include: { applicant: { select: { firstName: true, lastName: true, email: true } } },
    });
  }

  async getProfilesByBatch(batchId: string) {
    return this.prisma.applicant.findMany({
      where: { batchId, status: { not: 'REMOVED' } },
      include: {
        matchingProfile: true,
      },
      orderBy: { appliedAt: 'asc' },
    });
  }

  // ─── Internal Algorithms ─────────────────────────────

  /**
   * Group applicants by their idea category
   */
  private groupByIdeaCategory(applicants: ApplicantProfile[]): Record<string, ApplicantProfile[]> {
    const groups: Record<string, ApplicantProfile[]> = {};

    for (const a of applicants) {
      const cat = a.matchingProfile?.ideaCategory || 'OTHER';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(a);
    }

    return groups;
  }

  /**
   * Form teams from a group of same-category applicants (idea-based)
   */
  private formTeamsFromGroup(
    members: ApplicantProfile[],
    config: MatchingConfig,
    teamType: TeamType,
    category: IdeaCategory,
    offset: number,
  ): TeamAssignment[] {
    const teams: TeamAssignment[] = [];
    const targetSize = Math.floor((config.minTeamSize + config.maxTeamSize) / 2);
    let numTeams = Math.max(1, Math.floor(members.length / targetSize));

    // Sort by skill diversity for better distribution
    const sorted = this.sortBySkillDiversity(members);

    let index = 0;
    for (let i = 0; i < numTeams; i++) {
      const baseSize = Math.floor(sorted.length / numTeams);
      const extra = i < (sorted.length % numTeams) ? 1 : 0;
      const teamSize = Math.min(baseSize + extra, config.maxTeamSize);

      const teamMembers = sorted.slice(index, index + teamSize);
      const matchScore = this.calculateTeamScore(teamMembers, config);

      teams.push({
        teamName: `Team ${String.fromCharCode(65 + ((offset + teams.length) % 26))}${(offset + teams.length) >= 26 ? Math.floor((offset + teams.length) / 26) : ''}`,
        teamType,
        ideaCategory: category,
        memberIds: teamMembers.map(m => m.id),
        matchScore,
      });

      index += teamSize;
    }

    return teams;
  }

  /**
   * Form diverse builder-pool teams optimized for skill diversity + commitment compatibility
   */
  private formDiverseTeams(
    members: ApplicantProfile[],
    config: MatchingConfig,
    offset: number,
  ): TeamAssignment[] {
    const teams: TeamAssignment[] = [];
    const targetSize = Math.floor((config.minTeamSize + config.maxTeamSize) / 2);
    let numTeams = Math.max(1, Math.floor(members.length / targetSize));

    // Initialize empty team buckets
    const buckets: ApplicantProfile[][] = Array.from({ length: numTeams }, () => []);

    // Sort members by commitment level for even distribution
    const sorted = [...members].sort((a, b) => {
      const commitOrder: Record<string, number> = { FULL_TIME: 0, PART_TIME: 1, FLEXIBLE: 2, WEEKENDS_ONLY: 3 };
      const aLevel = a.matchingProfile?.commitmentLevel || 'FLEXIBLE';
      const bLevel = b.matchingProfile?.commitmentLevel || 'FLEXIBLE';
      return (commitOrder[aLevel] ?? 2) - (commitOrder[bLevel] ?? 2);
    });

    // Round-robin distribute for commitment diversity
    for (let i = 0; i < sorted.length; i++) {
      const bucketIdx = i % numTeams;
      if (buckets[bucketIdx].length < config.maxTeamSize) {
        buckets[bucketIdx].push(sorted[i]);
      } else {
        // Find a bucket with space
        const available = buckets.find(b => b.length < config.maxTeamSize);
        if (available) available.push(sorted[i]);
      }
    }

    // Now optimize each bucket for skill diversity via swap optimization
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < buckets.length; i++) {
        for (let j = i + 1; j < buckets.length; j++) {
          this.trySwapForDiversity(buckets[i], buckets[j], config);
        }
      }
    }

    // Convert buckets to assignments
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < config.minTeamSize) continue; // Skip too-small teams

      const matchScore = this.calculateTeamScore(buckets[i], config);
      teams.push({
        teamName: `Team ${String.fromCharCode(65 + ((offset + i) % 26))}${(offset + i) >= 26 ? Math.floor((offset + i) / 26) : ''}`,
        teamType: TeamType.BUILDER_POOL,
        ideaCategory: null,
        memberIds: buckets[i].map(m => m.id),
        matchScore,
      });
    }

    return teams;
  }

  /**
   * Try swapping members between two teams to improve skill diversity
   */
  private trySwapForDiversity(
    teamA: ApplicantProfile[],
    teamB: ApplicantProfile[],
    config: MatchingConfig,
  ): void {
    const currentScoreA = this.calculateSkillDiversity(teamA);
    const currentScoreB = this.calculateSkillDiversity(teamB);
    const currentTotal = currentScoreA + currentScoreB;

    let bestSwap: { idxA: number; idxB: number; improvement: number } | null = null;

    for (let a = 0; a < teamA.length; a++) {
      for (let b = 0; b < teamB.length; b++) {
        // Simulate swap
        const tempA = [...teamA];
        const tempB = [...teamB];
        [tempA[a], tempB[b]] = [tempB[b], tempA[a]];

        const newScoreA = this.calculateSkillDiversity(tempA);
        const newScoreB = this.calculateSkillDiversity(tempB);
        const newTotal = newScoreA + newScoreB;

        const improvement = newTotal - currentTotal;
        if (improvement > 0 && (!bestSwap || improvement > bestSwap.improvement)) {
          bestSwap = { idxA: a, idxB: b, improvement };
        }
      }
    }

    if (bestSwap) {
      [teamA[bestSwap.idxA], teamB[bestSwap.idxB]] = [teamB[bestSwap.idxB], teamA[bestSwap.idxA]];
    }
  }

  /**
   * Calculate overall team compatibility score (0-100)
   */
  private calculateTeamScore(members: ApplicantProfile[], config: MatchingConfig): number {
    if (members.length === 0) return 0;

    const w = config.weights;
    let score = 0;

    // Skill diversity score (0-1): how many unique skills across the team
    score += this.calculateSkillDiversity(members) * w.skillDiversity;

    // Commitment compatibility (0-1): how aligned commitment levels are
    score += this.calculateCommitmentCompatibility(members) * w.commitmentLevel;

    // Personality balance (0-1): how well-balanced personality types are
    score += this.calculatePersonalityBalance(members) * w.personality;

    // Experience diversity (0-1): mix of experience levels
    score += this.calculateExperienceDiversity(members) * w.experience;

    // Idea category cohesion (0-1): for idea-based teams
    score += this.calculateIdeaCohesion(members) * w.ideaCategory;

    return Math.round(score * 100);
  }

  /**
   * Skill diversity: ratio of unique skills to total skill slots
   */
  private calculateSkillDiversity(members: ApplicantProfile[]): number {
    const allSkills = members.flatMap(m => {
      const skills = m.matchingProfile?.skills;
      return Array.isArray(skills) ? skills : [];
    });

    if (allSkills.length === 0) return 0.5; // Neutral if no data

    const uniqueSkills = new Set(allSkills.map(s => s.toLowerCase().trim()));
    return Math.min(1, uniqueSkills.size / Math.max(allSkills.length * 0.7, 1));
  }

  /**
   * Commitment compatibility: higher score if members have similar commitment
   */
  private calculateCommitmentCompatibility(members: ApplicantProfile[]): number {
    const levels = members
      .map(m => m.matchingProfile?.commitmentLevel || 'FLEXIBLE')
      .map(l => ({ FULL_TIME: 4, PART_TIME: 3, FLEXIBLE: 2, WEEKENDS_ONLY: 1 } as Record<string, number>)[l] ?? 2);

    if (levels.length <= 1) return 1;

    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    const variance = levels.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / levels.length;

    // Lower variance = higher compatibility
    return Math.max(0, 1 - variance / 4);
  }

  /**
   * Personality balance: optimal when team has diverse personality types
   */
  private calculatePersonalityBalance(members: ApplicantProfile[]): number {
    const scores = members
      .map(m => m.matchingProfile?.personalityScores as PersonalityScores | null)
      .filter(Boolean) as PersonalityScores[];

    if (scores.length === 0) return 0.5; // Neutral if no data

    const dims = ['leadership', 'execution', 'creativity', 'analytical'] as const;
    let balance = 0;

    for (const dim of dims) {
      const values = scores.map(s => s[dim] || 0);
      const max = Math.max(...values);
      const min = Math.min(...values);
      // Good balance = range is wide (diverse team)
      balance += (max - min) / 10; // Assuming 0-10 scale
    }

    return Math.min(1, balance / dims.length);
  }

  /**
   * Experience diversity: best when team has mix of junior + senior
   */
  private calculateExperienceDiversity(members: ApplicantProfile[]): number {
    const years = members
      .map(m => m.matchingProfile?.experienceYears)
      .filter((y): y is number => y != null);

    if (years.length <= 1) return 0.5;

    const max = Math.max(...years);
    const min = Math.min(...years);
    const range = max - min;

    // Ideal range is 3-10 years difference
    if (range >= 3 && range <= 10) return 1;
    if (range < 3) return range / 3;
    return Math.max(0, 1 - (range - 10) / 10);
  }

  /**
   * Idea cohesion: higher if members share the same idea category
   */
  private calculateIdeaCohesion(members: ApplicantProfile[]): number {
    const categories = members
      .map(m => m.matchingProfile?.ideaCategory)
      .filter(Boolean) as string[];

    if (categories.length === 0) return 0.5;

    const counts: Record<string, number> = {};
    for (const c of categories) {
      counts[c] = (counts[c] || 0) + 1;
    }

    const maxCount = Math.max(...Object.values(counts));
    return maxCount / categories.length;
  }

  /**
   * Sort by unique skill count (ascending) for interleaved distribution
   */
  private sortBySkillDiversity(members: ApplicantProfile[]): ApplicantProfile[] {
    return [...members].sort((a, b) => {
      const aSkills = Array.isArray(a.matchingProfile?.skills) ? a.matchingProfile!.skills.length : 0;
      const bSkills = Array.isArray(b.matchingProfile?.skills) ? b.matchingProfile!.skills.length : 0;
      return aSkills - bSkills;
    });
  }

  /**
   * Distribute remaining applicants into existing teams
   */
  private distributeRemainder(
    remaining: ApplicantProfile[],
    teams: TeamAssignment[],
    maxSize: number,
  ): void {
    for (const member of remaining) {
      const target = teams
        .filter(t => t.memberIds.length < maxSize)
        .sort((a, b) => a.memberIds.length - b.memberIds.length)[0];

      if (target) {
        target.memberIds.push(member.id);
      }
    }
  }
}
