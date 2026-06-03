import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

    const electionDeadlineStr = deadline
      ? new Date(deadline).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'No specific deadline';
    const hubUrl = `${process.env.FRONTEND_URL || 'https://aryavartham.com'}/hub`;
    // Notify members in parallel rather than serially.
    await Promise.allSettled(
      members.map((member) =>
        this.emailService.sendTemplatedEmail(
          member.email,
          'election-started',
          {
            firstName: member.firstName,
            teamName: team.name,
            instructions: instructions || 'A leadership election has begun for your team.',
            deadline: electionDeadlineStr,
            hubUrl,
          },
          member.id,
        ),
      ),
    );

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

    // The nominator must also belong to the election's team.
    const nominator = await this.prisma.applicant.findFirst({
      where: { id: nominatedById ?? '', teamId: election.teamId },
    });
    if (!nominator) throw new ForbiddenException('Only team members can nominate');

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

  // Minimum fraction of eligible team members that must vote before a VOTING
  // election can be finalized (unless its deadline has already passed).
  private static readonly VOTING_QUORUM_FRACTION = 0.5;

  async advanceElection(electionId: string) {
    const election = await this.prisma.leaderElection.findUnique({
      where: { id: electionId },
      include: {
        _count: { select: { nominations: true, votes: true } },
        nominations: true,
      },
    });
    if (!election) throw new NotFoundException('Election not found');

    // A NULL deadline means "no deadline set" — it must NOT be treated as
    // "already passed". `deadlinePassed` is true only when a real deadline
    // exists and lies in the past. When no deadline is set we instead gate
    // finalization on a real participation quorum (see below).
    const hasDeadline = election.deadline != null;
    const deadlinePassed =
      hasDeadline && election.deadline!.getTime() <= Date.now();

    const eligibleVoters = await this.prisma.applicant.count({
      where: { teamId: election.teamId },
    });
    // Majority quorum of eligible team members.
    const quorum = Math.max(
      1,
      Math.ceil(eligibleVoters * ElectionService.VOTING_QUORUM_FRACTION),
    );

    if (election.status === 'NOMINATION') {
      if (election._count.nominations === 0) {
        throw new BadRequestException('No nominations yet');
      }

      // ─── Sole nominee: auto-elect, but only once the deadline has passed
      //     (so late nominations are not silently excluded) OR, when no
      //     deadline is set, only once a majority of eligible members have
      //     actually participated by nominating. With a lone nomination this
      //     quorum can only be met when the team is effectively a single
      //     member, preventing a premature unopposed coronation. ───
      if (election._count.nominations === 1) {
        if (!deadlinePassed) {
          if (hasDeadline) {
            throw new BadRequestException(
              'Cannot auto-elect sole nominee before the election deadline',
            );
          }
          // No deadline: require majority participation before crowning a
          // sole nominee unopposed.
          if (election._count.nominations < quorum) {
            throw new BadRequestException(
              `Cannot auto-elect sole nominee: only ${election._count.nominations}/${quorum} eligible members have participated and no deadline is set`,
            );
          }
        }

        const soleNominee = election.nominations[0];

        const winnerId = await this.finalizeWinner(
          electionId,
          election.teamId,
          'NOMINATION',
          soleNominee.nomineeId,
        );

        this.logger.log(
          `Election ${electionId}: Sole nominee ${winnerId} auto-elected as leader`,
        );

        await this.sendElectionResultEmails(election.teamId, winnerId);

        return { status: 'COMPLETED', winnerId, unanimous: true };
      }

      // Move to voting (atomic, idempotent: only from NOMINATION).
      const moved = await this.prisma.leaderElection.updateMany({
        where: { id: electionId, status: 'NOMINATION' },
        data: { status: 'VOTING' },
      });
      if (moved.count === 0) {
        throw new ConflictException('Election phase already changed');
      }

      return { status: 'VOTING' };
    }

    if (election.status === 'VOTING') {
      // ─── Quorum / deadline gating ───
      // Finalize early only if a real quorum of eligible members has voted;
      // otherwise wait until the deadline has passed. This prevents a single
      // vote from prematurely deciding the election. When NO deadline is set,
      // the quorum is the ONLY gate — a null deadline never short-circuits to
      // "expired", so a lone vote cannot finalize the election.
      const totalVotes = election._count.votes;

      if (!deadlinePassed && totalVotes < quorum) {
        const reason = hasDeadline
          ? 'and deadline has not passed'
          : 'and no deadline is set';
        throw new BadRequestException(
          `Quorum not reached (${totalVotes}/${quorum}) ${reason}`,
        );
      }

      if (totalVotes === 0) {
        throw new BadRequestException('No votes cast yet');
      }

      // Tally votes with a DETERMINISTIC tie-break: highest count, then
      // earliest nomination createdAt, then nomination id. We do not rely
      // on DB row order for ties.
      const tally = await this.prisma.leaderVote.groupBy({
        by: ['nomineeId'],
        where: { electionId },
        _count: { nomineeId: true },
      });

      if (tally.length === 0) {
        throw new BadRequestException('No votes cast yet');
      }

      // Build deterministic tie-break keys from the nominations themselves.
      const nominationByNominee = new Map(
        election.nominations.map((n) => [
          n.nomineeId,
          { createdAt: n.createdAt.getTime(), id: n.id },
        ]),
      );

      const ranked = tally
        .map((t) => ({
          nomineeId: t.nomineeId,
          count: t._count.nomineeId,
          tieBreak: nominationByNominee.get(t.nomineeId) ?? {
            // Votes for a nominee without a nomination row sort last.
            createdAt: Number.MAX_SAFE_INTEGER,
            id: t.nomineeId,
          },
        }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          if (a.tieBreak.createdAt !== b.tieBreak.createdAt) {
            return a.tieBreak.createdAt - b.tieBreak.createdAt;
          }
          return a.tieBreak.id < b.tieBreak.id ? -1 : a.tieBreak.id > b.tieBreak.id ? 1 : 0;
        });

      const winnerId = ranked[0].nomineeId;

      await this.finalizeWinner(electionId, election.teamId, 'VOTING', winnerId);

      await this.sendElectionResultEmails(election.teamId, winnerId);

      const voteBreakdown = ranked.map((r) => ({
        nomineeId: r.nomineeId,
        _count: r.count,
      }));

      return { status: 'COMPLETED', winnerId, voteBreakdown };
    }

    throw new BadRequestException('Election already completed');
  }

  /**
   * Atomically finalize an election winner.
   *
   * Transitions status from `expectedStatus` -> COMPLETED, sets the winner,
   * and assigns the team leader, all inside a single transaction. The status
   * transition uses a conditional updateMany so that two concurrent callers
   * cannot both elect a winner: only the call that observes the election still
   * in `expectedStatus` succeeds; the loser throws ConflictException and makes
   * no further writes.
   */
  private async finalizeWinner(
    electionId: string,
    teamId: string,
    expectedStatus: 'NOMINATION' | 'VOTING',
    winnerId: string,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.leaderElection.updateMany({
        where: { id: electionId, status: expectedStatus },
        data: {
          status: 'COMPLETED',
          winnerId,
          completedAt: new Date(),
        },
      });

      if (transitioned.count === 0) {
        // Another concurrent call already finalized this election.
        throw new ConflictException('Election has already been finalized');
      }

      await tx.team.update({
        where: { id: teamId },
        data: { leaderId: winnerId },
      });

      return winnerId;
    });
  }

  /**
   * Best-effort result-email dispatch. This runs AFTER the election has been
   * irreversibly finalized (status COMPLETED + leader assigned), so it must
   * never throw: a mail-provider failure here would 500 the advance request
   * even though the state change already succeeded. All errors are swallowed
   * and logged; sends fan out in parallel via Promise.allSettled.
   */
  private async sendElectionResultEmails(teamId: string, winnerId: string) {
    try {
      const team = await this.prisma.team.findUnique({
        where: { id: teamId },
        include: { members: { select: { id: true, email: true, firstName: true } } },
      });
      const winner = await this.prisma.applicant.findUnique({
        where: { id: winnerId },
        select: { firstName: true, lastName: true },
      });

      if (team && winner) {
        const results = await Promise.allSettled(
          team.members.map((member) =>
            this.emailService.sendTemplatedEmail(
              member.email,
              'election-result',
              {
                firstName: member.firstName,
                teamName: team.name,
                winnerName: `${winner.firstName} ${winner.lastName}`,
                hubUrl: `${process.env.FRONTEND_URL || 'https://aryavartham.com'}/hub`,
              },
              member.id,
            ),
          ),
        );

        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          this.logger.warn(
            `Election result emails: ${failed}/${team.members.length} failed to send for team ${teamId}`,
          );
        }
      }
    } catch (err) {
      // Never let post-finalization mail dispatch throw and 500 the request.
      this.logger.error(
        `Failed to dispatch election result emails for team ${teamId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Authorize a team-scoped read: admins may read any team's data; everyone
   * else may only read elections belonging to their own (non-null) team.
   * Prevents IDOR enumeration of other teams' nominees/pitches/results.
   */
  private async assertTeamReadAccess(
    teamId: string,
    requesterId?: string,
    requesterRole?: string,
  ) {
    const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(
      requesterRole || '',
    );
    if (isAdmin) return;

    const requester = requesterId
      ? await this.prisma.applicant.findUnique({
          where: { id: requesterId },
          select: { teamId: true },
        })
      : null;
    if (!requester?.teamId || requester.teamId !== teamId) {
      throw new ForbiddenException(
        "You can only view your own team's election",
      );
    }
  }

  async getElection(
    electionId: string,
    requesterId?: string,
    requesterRole?: string,
  ) {
    const election = await this.prisma.leaderElection.findUnique({
      where: { id: electionId },
      include: {
        _count: { select: { nominations: true, votes: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
        team: { select: { name: true, id: true } },
      },
    });
    if (!election) return null;

    await this.assertTeamReadAccess(
      election.teamId,
      requesterId,
      requesterRole,
    );

    // Surface the caller's own ballot so a returning voter's UI reflects it.
    // Votes are keyed by (electionId, voterId === applicantId).
    const myVote = requesterId
      ? await this.prisma.leaderVote.findUnique({
          where: { electionId_voterId: { electionId, voterId: requesterId } },
          select: { nomineeId: true },
        })
      : null;

    return { ...election, myVote };
  }

  async getActiveElection(
    teamId: string,
    requesterId?: string,
    requesterRole?: string,
  ) {
    await this.assertTeamReadAccess(teamId, requesterId, requesterRole);

    return this.prisma.leaderElection.findFirst({
      where: { teamId, status: { not: 'COMPLETED' } },
      include: {
        _count: { select: { nominations: true, votes: true } },
        questions: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async getNominees(
    electionId: string,
    requesterId?: string,
    requesterRole?: string,
  ) {
    const election = await this.getElectionOrThrow(electionId);
    await this.assertTeamReadAccess(
      election.teamId,
      requesterId,
      requesterRole,
    );

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

  async getResults(
    electionId: string,
    requesterId?: string,
    requesterRole?: string,
  ) {
    const election = await this.prisma.leaderElection.findUnique({
      where: { id: electionId },
      include: {
        nominations: true,
      },
    });
    if (!election) throw new NotFoundException('Election not found');

    await this.assertTeamReadAccess(
      election.teamId,
      requesterId,
      requesterRole,
    );

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
