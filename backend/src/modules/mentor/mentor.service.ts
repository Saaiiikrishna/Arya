import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const CHANGE_REQUEST_TYPES = ['SEPARATION', 'JOIN_EXISTING', 'CREATE_NEW'];

@Injectable()
export class MentorService {
  private readonly logger = new Logger(MentorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // ─── Auth ──────────────────────────────────────────────────

  async login(email: string, password: string) {
    const mentor = await (this.prisma as any).mentor.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!mentor || !mentor.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, mentor.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload = { sub: mentor.id, email: mentor.email, role: 'MENTOR' };
    const refreshToken = this.signRefreshToken(payload);
    await this.storeRefreshToken(mentor.id, refreshToken);

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken,
      mentor: {
        id: mentor.id,
        email: mentor.email,
        firstName: mentor.firstName,
        lastName: mentor.lastName,
        role: 'MENTOR',
      },
    };
  }

  // ─── Admin operations ─────────────────────────────────────

  async createMentor(dto: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    expertise?: string[];
    bio?: string;
  }) {
    const existing = await (this.prisma as any).mentor.findUnique({ where: { email: dto.email.toLowerCase().trim() } });
    if (existing) throw new ConflictException('A mentor with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    return (this.prisma as any).mentor.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        expertise: dto.expertise ?? [],
        bio: dto.bio,
      },
      select: { id: true, email: true, firstName: true, lastName: true, expertise: true, isActive: true, createdAt: true },
    });
  }

  async listMentors() {
    return (this.prisma as any).mentor.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        expertise: true,
        isActive: true,
        createdAt: true,
        assignments: {
          where: { isActive: true },
          include: { team: { select: { id: true, name: true, batchId: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMentor(id: string) {
    const mentor = await (this.prisma as any).mentor.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        expertise: true,
        bio: true,
        isActive: true,
        createdAt: true,
        assignments: {
          where: { isActive: true },
          include: {
            team: {
              select: {
                id: true,
                name: true,
                isLocked: true,
                memberCount: true,
                requests: { where: { mentorStatus: 'PENDING' } },
              },
            },
          },
        },
      },
    });
    if (!mentor) throw new NotFoundException('Mentor not found');
    return mentor;
  }

  async assignToTeam(mentorId: string, teamId: string, adminId: string) {
    const [mentor, team] = await Promise.all([
      (this.prisma as any).mentor.findUnique({ where: { id: mentorId } }),
      this.prisma.team.findUnique({ where: { id: teamId } }),
    ]);
    if (!mentor || !mentor.isActive) throw new NotFoundException('Mentor not found or inactive');
    if (!team) throw new NotFoundException('Team not found');

    const existing = await (this.prisma as any).mentorAssignment.findUnique({
      where: { mentorId_teamId: { mentorId, teamId } },
    });
    if (existing && existing.isActive) throw new ConflictException('Mentor is already assigned to this team');

    const assignment = await (this.prisma as any).mentorAssignment.upsert({
      where: { mentorId_teamId: { mentorId, teamId } },
      create: { mentorId, teamId, batchId: team.batchId },
      update: { isActive: true },
    });

    // Notify all team members
    const members = await this.prisma.applicant.findMany({
      where: { teamId, status: { not: 'REMOVED' } },
      select: { id: true, email: true, firstName: true, whatsappPhone: true, whatsappVerified: true },
    });
    const mentorName = `${mentor.firstName} ${mentor.lastName}`;

    await Promise.allSettled([
      ...members.map((m) =>
        this.emailService.sendTemplatedEmail(
          m.email,
          'mentor-assigned',
          { firstName: m.firstName, mentorName, mentorEmail: mentor.email, teamName: team.name },
          m.id,
        ),
      ),
      ...members
        .filter((m) => m.whatsappPhone && m.whatsappVerified)
        .map((m) =>
          this.whatsappService.sendMentorAssigned(
            m.whatsappPhone!,
            m.firstName,
            mentorName,
            mentor.email,
            m.id,
          ),
        ),
    ]);

    this.logger.log(`Mentor ${mentor.email} assigned to team ${team.name} by admin ${adminId}`);
    return assignment;
  }

  // ─── Mentor portal ────────────────────────────────────────

  async getMyTeams(mentorId: string) {
    return (this.prisma as any).mentorAssignment.findMany({
      where: { mentorId, isActive: true },
      include: {
        team: {
          include: {
            members: {
              where: { status: { not: 'REMOVED' } },
              select: { id: true, firstName: true, lastName: true, department: true, status: true },
            },
            requests: {
              where: { mentorStatus: 'PENDING' },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getPendingRequests(mentorId: string) {
    const assignments = await (this.prisma as any).mentorAssignment.findMany({
      where: { mentorId, isActive: true },
      select: { teamId: true },
    });
    const teamIds = assignments.map((a: { teamId: string }) => a.teamId);

    return this.prisma.teamRequest.findMany({
      where: {
        teamId: { in: teamIds },
        type: { in: CHANGE_REQUEST_TYPES as any[] },
        mentorStatus: 'PENDING',
      },
      include: {
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewRequest(mentorId: string, reqId: string, status: 'APPROVED' | 'REJECTED') {
    const request = await this.prisma.teamRequest.findUnique({ where: { id: reqId } });
    if (!request) throw new NotFoundException('Request not found');
    if (!CHANGE_REQUEST_TYPES.includes(request.type)) {
      throw new BadRequestException('Only change-type requests require mentor review');
    }
    if (request.mentorStatus !== 'PENDING') {
      throw new BadRequestException('This request has already been reviewed by a mentor');
    }

    // Verify this mentor is assigned to the team
    const assignment = await (this.prisma as any).mentorAssignment.findUnique({
      where: { mentorId_teamId: { mentorId, teamId: request.teamId } },
    });
    if (!assignment || !assignment.isActive) {
      throw new ForbiddenException('You are not the assigned mentor for this team');
    }

    const updated = await this.prisma.teamRequest.update({
      where: { id: reqId },
      data: {
        mentorStatus: status as any,
        mentorReviewedById: mentorId,
        mentorReviewedAt: new Date(),
        // If mentor rejects, close the request entirely
        ...(status === 'REJECTED' ? { status: 'REJECTED', resolvedById: mentorId, resolvedAt: new Date() } : {}),
      },
    });

    this.logger.log(`Mentor ${mentorId} ${status} request ${reqId}`);
    return updated;
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
