import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import * as bcrypt from 'bcrypt';

@Injectable()
export class InvestorService {
  private readonly logger = new Logger(InvestorService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
