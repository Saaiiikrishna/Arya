import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class CoFounderService {
  private readonly logger = new Logger(CoFounderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // ─── Auth ──────────────────────────────────────────────────

  async login(email: string, password: string) {
    const cf = await (this.prisma as any).coFounder.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!cf || !cf.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, cf.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload = { sub: cf.id, email: cf.email, role: 'COFOUNDER' };
    const refreshToken = this.signRefreshToken(payload);
    await this.storeRefreshToken(cf.id, refreshToken);

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken,
      coFounder: { id: cf.id, email: cf.email, firstName: cf.firstName, lastName: cf.lastName, role: 'COFOUNDER' },
    };
  }

  // ─── Admin operations ─────────────────────────────────────

  async createCoFounder(dto: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    bio?: string;
  }) {
    const existing = await (this.prisma as any).coFounder.findUnique({ where: { email: dto.email.toLowerCase().trim() } });
    if (existing) throw new ConflictException('A co-founder with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    return (this.prisma as any).coFounder.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        bio: dto.bio,
      },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true },
    });
  }

  async listCoFounders() {
    return (this.prisma as any).coFounder.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        createdAt: true,
        assignments: {
          where: { isActive: true },
          include: { team: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async assignToTeam(coFounderId: string, teamId: string, adminId: string) {
    const [cf, team] = await Promise.all([
      (this.prisma as any).coFounder.findUnique({ where: { id: coFounderId } }),
      this.prisma.team.findUnique({ where: { id: teamId } }),
    ]);
    if (!cf || !cf.isActive) throw new NotFoundException('Co-founder not found or inactive');
    if (!team) throw new NotFoundException('Team not found');
    if (!team.isLocked) throw new BadRequestException('Team must be locked before assigning a co-founder');

    const existing = await (this.prisma as any).coFounderAssignment.findUnique({ where: { teamId } });
    if (existing && existing.isActive) throw new ConflictException('This team already has an active co-founder');

    const assignment = await (this.prisma as any).coFounderAssignment.upsert({
      where: { teamId },
      create: { coFounderId, teamId, batchId: team.batchId },
      update: { coFounderId, isActive: true },
    });

    // Notify founding team
    const members = await this.prisma.applicant.findMany({
      where: { teamId, status: { not: 'REMOVED' } },
      select: { id: true, email: true, firstName: true, whatsappPhone: true, whatsappVerified: true },
    });
    const cfName = `${cf.firstName} ${cf.lastName}`;

    const results = await Promise.allSettled([
      ...members.map((m) =>
        this.emailService.sendTemplatedEmail(
          m.email,
          'cofounder-assigned',
          { firstName: m.firstName, coFounderName: cfName, coFounderEmail: cf.email, teamName: team.name },
          m.id,
        ),
      ),
      ...members
        .filter((m) => m.whatsappPhone && m.whatsappVerified)
        .map((m) =>
          this.whatsappService.sendCoFounderAssigned(m.whatsappPhone!, m.firstName, cfName, m.id),
        ),
    ]);
    results
      .filter((r) => r.status === 'rejected')
      .forEach((r: any) => this.logger.error(`Co-founder assignment notification failed: ${r.reason?.message ?? r.reason}`));

    this.logger.log(`Co-founder ${cf.email} assigned to team ${team.name} by admin ${adminId}`);
    return assignment;
  }

  // ─── Co-founder portal ────────────────────────────────────

  async getMyTeam(coFounderId: string) {
    const assignment = await (this.prisma as any).coFounderAssignment.findFirst({
      where: { coFounderId, isActive: true },
      include: {
        team: {
          include: {
            members: {
              where: { status: { not: 'REMOVED' } },
              select: { id: true, firstName: true, lastName: true, department: true },
            },
            project: true,
            sprints: { orderBy: { startDate: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (!assignment) throw new NotFoundException('No active team assignment found');
    return assignment;
  }

  async submitWeeklyReport(coFounderId: string, teamId: string, dto: {
    week: number;
    summary: string;
    blockers?: string;
    nextSteps?: string;
  }) {
    const assignment = await (this.prisma as any).coFounderAssignment.findFirst({
      where: { coFounderId, teamId, isActive: true },
    });
    if (!assignment) throw new NotFoundException('You are not assigned to this team');

    return (this.prisma as any).weeklyReport.upsert({
      where: { coFounderId_teamId_week: { coFounderId, teamId, week: dto.week } },
      create: { coFounderId, teamId, week: dto.week, summary: dto.summary, blockers: dto.blockers, nextSteps: dto.nextSteps },
      update: { summary: dto.summary, blockers: dto.blockers, nextSteps: dto.nextSteps },
    });
  }

  async createResourceRequest(coFounderId: string, teamId: string, dto: {
    type: string;
    description: string;
  }) {
    const assignment = await (this.prisma as any).coFounderAssignment.findFirst({
      where: { coFounderId, teamId, isActive: true },
    });
    if (!assignment) throw new NotFoundException('You are not assigned to this team');

    return (this.prisma as any).resourceRequest.create({
      data: { coFounderId, teamId, type: dto.type, description: dto.description },
    });
  }

  async getResourceRequests(teamId: string, status?: string) {
    const where: any = { teamId };
    if (status) where.status = status;
    return (this.prisma as any).resourceRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async fulfillResourceRequest(reqId: string, adminId: string, notes?: string) {
    return (this.prisma as any).resourceRequest.update({
      where: { id: reqId },
      data: { status: 'FULFILLED', fulfilledAt: new Date(), fulfilledBy: adminId, notes },
    });
  }

  // Admin: weekly reports inbox
  async getWeeklyReports(batchId?: string) {
    const where: any = {};
    if (batchId) {
      const teams = await this.prisma.team.findMany({ where: { batchId }, select: { id: true } });
      where.teamId = { in: teams.map((t) => t.id) };
    }
    return (this.prisma as any).weeklyReport.findMany({
      where,
      include: { team: { select: { id: true, name: true } } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────

  private signRefreshToken(payload: object): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d') as any,
    });
  }

  private async storeRefreshToken(userId: string, token: string): Promise<void> {
    const expStr = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = new Date(Date.now() + this.parseExpirationMs(expStr));
    const hashed = createHash('sha256').update(token).digest('hex');
    await this.prisma.refreshToken.create({ data: { userId, familyId: randomUUID(), token: hashed, expiresAt } });
  }

  private parseExpirationMs(expStr: string): number {
    const value = parseInt(expStr, 10);
    const unit = expStr.slice(-1);
    if (unit === 'd') return value * 86_400_000;
    if (unit === 'h') return value * 3_600_000;
    if (unit === 'm') return value * 60_000;
    return value * 1_000;
  }
}
