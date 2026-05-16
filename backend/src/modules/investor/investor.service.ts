import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class InvestorService {
  private readonly logger = new Logger(InvestorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // ─── Investor Registration & Auth ────────────────────

  async register(data: {
    email: string;
    firstName: string;
    lastName: string;
    firm?: string;
    bio?: string;
    linkedIn?: string;
    interests?: string[];
    password?: string;
  }) {
    const existing = await this.prisma.investor.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('Investor with this email already exists');

    const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : null;

    return this.prisma.investor.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        firm: data.firm,
        bio: data.bio,
        linkedIn: data.linkedIn,
        interests: data.interests || [],
        passwordHash,
      },
    });
  }

  async findAll(params?: { isApproved?: boolean }) {
    return this.prisma.investor.findMany({
      where: params?.isApproved !== undefined ? { isApproved: params.isApproved } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const investor = await this.prisma.investor.findUnique({
      where: { id },
      include: { meetingRequests: { include: { showcase: true } } },
    });
    if (!investor) throw new NotFoundException('Investor not found');
    return investor;
  }

  async approve(id: string) {
    return this.prisma.investor.update({
      where: { id },
      data: { isApproved: true },
    });
  }

  // ─── Startup Showcase ────────────────────────────────

  async createShowcase(data: {
    teamId: string;
    pitchSummary: string;
    mvpDemoUrl?: string;
    metrics?: any;
  }) {
    return this.prisma.startupShowcase.create({ data });
  }

  async updateShowcase(id: string, data: {
    pitchSummary?: string;
    mvpDemoUrl?: string;
    metrics?: any;
    isPublished?: boolean;
  }) {
    return this.prisma.startupShowcase.update({ where: { id }, data });
  }

  async getPublicShowcases(category?: string) {
    return this.prisma.startupShowcase.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getShowcaseById(id: string) {
    const showcase = await this.prisma.startupShowcase.findUnique({
      where: { id },
      include: { meetingRequests: true },
    });
    if (!showcase) throw new NotFoundException('Showcase not found');
    return showcase;
  }

  // ─── Meeting Requests ────────────────────────────────

  async requestMeeting(investorId: string, showcaseId: string, message?: string) {
    const investor = await this.prisma.investor.findUnique({ where: { id: investorId } });
    if (!investor || !investor.isApproved) throw new NotFoundException('Investor not found or not approved');

    return this.prisma.meetingRequest.create({
      data: { investorId, showcaseId, message },
    });
  }

  async updateMeetingStatus(id: string, status: 'ACCEPTED' | 'DECLINED' | 'COMPLETED', scheduledAt?: Date) {
    return this.prisma.meetingRequest.update({
      where: { id },
      data: { status, scheduledAt },
    });
  }

  async getMeetingRequests(showcaseId?: string, investorId?: string) {
    return this.prisma.meetingRequest.findMany({
      where: {
        ...(showcaseId ? { showcaseId } : {}),
        ...(investorId ? { investorId } : {}),
      },
      include: { investor: true, showcase: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Pitch Events ─────────────────────────────────────

  async createPitchEvent(dto: { teamId: string; scheduledAt: string; venue?: string; notes?: string }) {
    const team = await this.prisma.team.findUnique({
      where: { id: dto.teamId },
      include: { leader: { select: { id: true, email: true, firstName: true, whatsappPhone: true, whatsappVerified: true } } },
    });
    if (!team) throw new NotFoundException('Team not found');

    const event = await (this.prisma as any).pitchEvent.create({
      data: {
        teamId: dto.teamId,
        scheduledAt: new Date(dto.scheduledAt),
        venue: dto.venue,
        notes: dto.notes,
      },
      include: { team: { select: { id: true, name: true } } },
    });

    const pitchDate = new Date(dto.scheduledAt).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const venue = dto.venue ?? 'To be confirmed';

    // Notify team leader
    if (team.leader) {
      await Promise.allSettled([
        this.emailService.sendTemplatedEmail(
          team.leader.email,
          'pitch-invitation',
          { firstName: team.leader.firstName, teamName: team.name, pitchDate, venue },
          team.leader.id,
        ),
        ...(team.leader.whatsappPhone && team.leader.whatsappVerified
          ? [this.whatsappService.sendPitchInvitation(
              team.leader.whatsappPhone,
              team.leader.firstName,
              team.name,
              pitchDate,
              venue,
              team.leader.id,
            )]
          : []),
      ]);
    }

    // Notify co-founder
    const cfAssignment = await (this.prisma as any).coFounderAssignment.findFirst({
      where: { teamId: dto.teamId, isActive: true },
      include: { coFounder: { select: { id: true, email: true, firstName: true } } },
    });
    if (cfAssignment?.coFounder) {
      await this.emailService.sendTemplatedEmail(
        cfAssignment.coFounder.email,
        'pitch-invitation',
        { firstName: cfAssignment.coFounder.firstName, teamName: team.name, pitchDate, venue },
        cfAssignment.coFounder.id,
      ).catch(() => {});
    }

    return event;
  }

  async listPitchEvents(teamId?: string, batchId?: string) {
    const where: any = {};
    if (teamId) where.teamId = teamId;
    if (batchId) where.team = { batchId };

    return (this.prisma as any).pitchEvent.findMany({
      where,
      include: {
        team: { select: { id: true, name: true, batchId: true } },
        investorInterests: true,
        fundingDecisions: true,
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async updatePitchEventStatus(id: string, status: string) {
    const ALLOWED = ['SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED'];
    if (!ALLOWED.includes(status)) throw new BadRequestException(`Invalid status. Allowed: ${ALLOWED.join(', ')}`);
    const event = await (this.prisma as any).pitchEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Pitch event not found');
    return (this.prisma as any).pitchEvent.update({ where: { id }, data: { status } });
  }

  async recordInvestorInterest(pitchEventId: string, dto: { investorId: string; status: string; notes?: string }) {
    const ALLOWED = ['SHORTLISTED', 'PASSED', 'WATCHING'];
    if (!ALLOWED.includes(dto.status)) throw new BadRequestException(`Invalid interest status. Allowed: ${ALLOWED.join(', ')}`);
    const event = await (this.prisma as any).pitchEvent.findUnique({ where: { id: pitchEventId } });
    if (!event) throw new NotFoundException('Pitch event not found');

    return (this.prisma as any).investorInterest.upsert({
      where: { pitchEventId_investorId: { pitchEventId, investorId: dto.investorId } },
      create: { pitchEventId, investorId: dto.investorId, status: dto.status, notes: dto.notes },
      update: { status: dto.status, notes: dto.notes },
    });
  }

  async recordFundingDecision(pitchEventId: string, dto: { investorId: string; outcome: string; amount?: number; terms?: any; notes?: string }) {
    const ALLOWED = ['FUNDED', 'PASSED', 'DEFERRED'];
    if (!ALLOWED.includes(dto.outcome)) throw new BadRequestException(`Invalid outcome. Allowed: ${ALLOWED.join(', ')}`);
    const event = await (this.prisma as any).pitchEvent.findUnique({ where: { id: pitchEventId } });
    if (!event) throw new NotFoundException('Pitch event not found');

    return (this.prisma as any).fundingDecision.upsert({
      where: { pitchEventId_investorId: { pitchEventId, investorId: dto.investorId } },
      create: { pitchEventId, investorId: dto.investorId, outcome: dto.outcome, amount: dto.amount, terms: dto.terms, notes: dto.notes },
      update: { outcome: dto.outcome, amount: dto.amount, terms: dto.terms, notes: dto.notes },
    });
  }
}
