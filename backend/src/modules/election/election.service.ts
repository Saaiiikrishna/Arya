import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email';

@Injectable()
export class ElectionService {
  private readonly logger = new Logger(ElectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Start election for a single team ──────────────────
  async startElection(
    teamId: string,
    instructions?: string,
    deadline?: string,
    questionIds?: string[],
  ) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { elections: { where: { status: { not: 'COMPLETED' } } } },
    });

    if (!team) throw new NotFoundException('Team not found');
    if (team.elections.length > 0) {
      throw new ConflictException('Team already has an active election');
    }

    const election = await this.prisma.leaderElection.create({
      data: {
        teamId,
        instructions: instructions || null,
        deadline: deadline ? new Date(deadline) : null,
      },
    });

    // Copy template questions to this election if questionIds provided
    if (questionIds && questionIds.length > 0) {
      const templates = await this.prisma.electionQuestion.findMany({
        where: { id: { in: questionIds }, isTemplate: true },
      });

      for (const template of templates) {
        await this.prisma.electionQuestion.create({
          data: {
            electionId: election.id,
            label: template.label,
            helpText: template.helpText,
            type: template.type,
            options: template.options as any ?? undefined,
            isRequired: template.isRequired,
            isTemplate: false,
            sortOrder: template.sortOrder,
          },
        });
      }
    }

    // Notify team members
    const members = await this.prisma.applicant.findMany({
      where: { teamId },
      select: { id: true, email: true, firstName: true },
    });

    for (const member of members) {
      await this.emailService.sendTemplatedEmail(
        member.email,
        'election-started',
        {
          firstName: member.firstName,
          teamName: team.name,
          instructions: instructions || 'A leadership election has begun for your team.',
          deadline: deadline
            ? new Date(deadline).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'No specific deadline',
          hubUrl: `${process.env.FRONTEND_URL || 'https://aryavartham.com'}/hub`,
        },
        member.id,
      );
    }

    return election;
  }

  // ─── Start election for ALL teams in a batch ──────────
  async startBatchElections(
    batchId: string,
    instructions?: string,
    deadline?: string,
    questionIds?: string[],
  ) {
    const teams = await this.prisma.team.findMany({
      where: { batchId },
      include: { elections: { where: { status: { not: 'COMPLETED' } } } },
    });

    if (teams.length === 0) {
      throw new NotFoundException('No teams found in this batch');
    }

    const results = [];
    for (const team of teams) {
      if (team.elections.length > 0) {
        results.push({
          teamId: team.id,
          teamName: team.name,
          status: 'skipped',
          reason: 'Active election exists',
        });
        continue;
      }

      try {
        const election = await this.startElection(
          team.id,
          instructions,
          deadline,
          questionIds,
        );
        results.push({
          teamId: team.id,
          teamName: team.name,
          status: 'started',
          electionId: election.id,
        });
      } catch (err) {
        results.push({
          teamId: team.id,
          teamName: team.name,
          status: 'error',
          reason: (err as Error).message,
        });
      }
    }

    return { totalTeams: teams.length, results };
  }

  // ─── Self-nominate ─────────────────────────────────────
  async selfNominate(
    electionId: string,
    nomineeId: string,
    pitch?: string,
    answers?: { questionId: string; value: any }[],
  ) {
    const election = await this.getElectionOrThrow(electionId);
    if (election.status !== 'NOMINATION') {
      throw new BadRequestException('Not in nomination phase');
    }

    // Check if already nominated
    const existing = await this.prisma.nomination.findUnique({
      where: {
        electionId_nomineeId: { electionId, nomineeId },
      },
    });
    if (existing) {
      throw new ConflictException('Already nominated');
    }

    // Verify nominee is a member of the team
    const member = await this.prisma.applicant.findFirst({
      where: { id: nomineeId, teamId: election.teamId },
    });
    if (!member) throw new BadRequestException('Not a team member');

    const nomination = await this.prisma.nomination.create({
      data: {
        electionId,
        nomineeId,
        nominatedById: nomineeId,
        isSelfNomination: true,
        pitch: pitch || null,
      },
    });

    // Save answers to election questions
    if (answers && answers.length > 0) {
      for (const answer of answers) {
        await this.prisma.nominationAnswer.create({
          data: {
            nominationId: nomination.id,
            questionId: answer.questionId,
            value: answer.value,
          },
        });
      }
    }

    return nomination;
  }

  async nominate(
    electionId: string,
    nomineeId: string,
    nominatedById?: string,
    reason?: string,
  ) {
    const election = await this.getElectionOrThrow(electionId);
    if (election.status !== 'NOMINATION') {
      throw new BadRequestException('Not in nomination phase');
    }

    const existing = await this.prisma.nomination.findUnique({
      where: {
        electionId_nomineeId: { electionId, nomineeId },
      },
    });
    if (existing) throw new ConflictException('Already nominated');

    const member = await this.prisma.applicant.findFirst({
      where: { id: nomineeId, teamId: election.teamId },
    });
    if (!member) throw new BadRequestException('Not a team member');

    return this.prisma.nomination.create({
      data: {
        electionId,
        nomineeId,
        nominatedById: nominatedById || null,
        isSelfNomination: false,
        reason: reason || null,
      },
    });
  }

  async submitPitch(electionId: string, nomineeId: string, pitch: string) {
    const nomination = await this.prisma.nomination.findUnique({
      where: {
        electionId_nomineeId: { electionId, nomineeId },
      },
    });
    if (!nomination) throw new NotFoundException('Nomination not found');

    return this.prisma.nomination.update({
      where: { id: nomination.id },
      data: { pitch },
    });
  }

  async castVote(electionId: string, voterId: string, nomineeId: string) {
    const election = await this.getElectionOrThrow(electionId);
    if (election.status !== 'VOTING') {
      throw new BadRequestException('Not in voting phase');
    }

    // Verify voter is a team member
    const voter = await this.prisma.applicant.findFirst({
      where: { id: voterId, teamId: election.teamId },
    });
    if (!voter) throw new BadRequestException('Not a team member');

    // Check for existing vote
    const existingVote = await this.prisma.leaderVote.findUnique({
      where: {
        electionId_voterId: { electionId, voterId },
      },
    });
    if (existingVote) throw new ConflictException('Already voted');

    // Verify nominee exists
    const nomination = await this.prisma.nomination.findUnique({
      where: {
        electionId_nomineeId: { electionId, nomineeId },
      },
    });
    if (!nomination) throw new BadRequestException('Nominee not found');

    return this.prisma.leaderVote.create({
      data: { electionId, voterId, nomineeId },
    });
  }

  async advanceElection(electionId: string) {
    const election = await this.prisma.leaderElection.findUnique({
      where: { id: electionId },
      include: {
        _count: { select: { nominations: true, votes: true } },
        nominations: true,
      },
    });
    if (!election) throw new NotFoundException('Election not found');

    if (election.status === 'NOMINATION') {
      if (election._count.nominations === 0) {
        throw new BadRequestException('No nominations yet');
      }

      // ─── Unanimous winner: if only 1 nominee, auto-complete ───
      if (election._count.nominations === 1) {
        const soleNominee = election.nominations[0];
        await this.prisma.leaderElection.update({
          where: { id: electionId },
          data: {
            status: 'COMPLETED',
            winnerId: soleNominee.nomineeId,
            completedAt: new Date(),
          },
        });

        // Assign as team leader
        await this.prisma.team.update({
          where: { id: election.teamId },
          data: { leaderId: soleNominee.nomineeId },
        });

        this.logger.log(
          `Election ${electionId}: Sole nominee ${soleNominee.nomineeId} auto-elected as leader`,
        );

        await this.sendElectionResultEmails(election.teamId, soleNominee.nomineeId);

        return { status: 'COMPLETED', winnerId: soleNominee.nomineeId, unanimous: true };
      }

      // Move to voting
      await this.prisma.leaderElection.update({
        where: { id: electionId },
        data: { status: 'VOTING' },
      });

      return { status: 'VOTING' };
    }

    if (election.status === 'VOTING') {
      // Tally votes
      const votes = await this.prisma.leaderVote.groupBy({
        by: ['nomineeId'],
        where: { electionId },
        _count: true,
        orderBy: { _count: { nomineeId: 'desc' } },
      });

      if (votes.length === 0) {
        throw new BadRequestException('No votes cast yet');
      }

      const winnerId = votes[0].nomineeId;
      await this.prisma.leaderElection.update({
        where: { id: electionId },
        data: {
          status: 'COMPLETED',
          winnerId,
          completedAt: new Date(),
        },
      });

      // Assign winner as team leader
      await this.prisma.team.update({
        where: { id: election.teamId },
        data: { leaderId: winnerId },
      });

      await this.sendElectionResultEmails(election.teamId, winnerId);

      return { status: 'COMPLETED', winnerId, voteBreakdown: votes };
    }

    throw new BadRequestException('Election already completed');
  }

  private async sendElectionResultEmails(teamId: string, winnerId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: { select: { id: true, email: true, firstName: true } } },
    });
    const winner = await this.prisma.applicant.findUnique({
      where: { id: winnerId },
      select: { firstName: true, lastName: true },
    });

    if (team && winner) {
      for (const member of team.members) {
        await this.emailService.sendTemplatedEmail(
          member.email,
          'election-result',
          {
            firstName: member.firstName,
            teamName: team.name,
            winnerName: `${winner.firstName} ${winner.lastName}`,
            hubUrl: `${process.env.FRONTEND_URL || 'https://aryavartham.com'}/hub`,
          },
          member.id,
        );
      }
    }
  }

  async getElection(electionId: string) {
    return this.prisma.leaderElection.findUnique({
      where: { id: electionId },
      include: {
        _count: { select: { nominations: true, votes: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
        team: { select: { name: true, id: true } },
      },
    });
  }

  async getActiveElection(teamId: string) {
    return this.prisma.leaderElection.findFirst({
      where: { teamId, status: { not: 'COMPLETED' } },
      include: {
        _count: { select: { nominations: true, votes: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async getNominees(electionId: string) {
    return this.prisma.nomination.findMany({
      where: { electionId },
      include: {
        answers: {
          include: { question: { select: { label: true, type: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getResults(electionId: string) {
    const election = await this.prisma.leaderElection.findUnique({
      where: { id: electionId },
      include: {
        nominations: true,
      },
    });
    if (!election) throw new NotFoundException('Election not found');

    const votes = await this.prisma.leaderVote.groupBy({
      by: ['nomineeId'],
      where: { electionId },
      _count: true,
      orderBy: { _count: { nomineeId: 'desc' } },
    });

    return { election, votes };
  }

  // ─── Election Question Templates ─────────────────────
  async createQuestionTemplate(data: {
    label: string;
    helpText?: string;
    type?: string;
    options?: any;
    isRequired?: boolean;
  }) {
    return this.prisma.electionQuestion.create({
      data: {
        label: data.label,
        helpText: data.helpText || null,
        type: (data.type as any) || 'TEXTAREA',
        options: data.options || null,
        isRequired: data.isRequired !== false,
        isTemplate: true,
      },
    });
  }

  async getQuestionTemplates() {
    return this.prisma.electionQuestion.findMany({
      where: { isTemplate: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteQuestionTemplate(id: string) {
    await this.prisma.electionQuestion.delete({ where: { id } });
    return { success: true };
  }

  // ─── Add custom questions to an election ──────────────
  async addCustomQuestion(
    electionId: string,
    data: {
      label: string;
      helpText?: string;
      type?: string;
      options?: any;
      isRequired?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.prisma.electionQuestion.create({
      data: {
        electionId,
        label: data.label,
        helpText: data.helpText || null,
        type: (data.type as any) || 'TEXTAREA',
        options: data.options || null,
        isRequired: data.isRequired !== false,
        isTemplate: false,
        sortOrder: data.sortOrder || 0,
      },
    });
  }

  private async getElectionOrThrow(electionId: string) {
    const election = await this.prisma.leaderElection.findUnique({
      where: { id: electionId },
    });
    if (!election) throw new NotFoundException('Election not found');
    return election;
  }
}
