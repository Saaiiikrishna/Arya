import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Verify a referrer by referral code, email, or phone number.
   * Returns the referrer's name and ID for display in the UI.
   */
  async verifyReferrer(query: string) {
    const trimmed = query.trim();
    if (!trimmed) throw new BadRequestException('Referral query cannot be empty');

    // Try to find by referral code first
    const byCode = await this.prisma.referralProfile.findUnique({
      where: { referralCode: trimmed.toUpperCase() },
      include: {
        applicant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (byCode && byCode.isActive) {
      return {
        found: true,
        referrerId: byCode.applicant.id,
        name: `${byCode.applicant.firstName} ${byCode.applicant.lastName}`.trim(),
        method: 'code',
      };
    }

    // Try by email
    const byEmail = await this.prisma.applicant.findUnique({
      where: { email: trimmed.toLowerCase() },
      select: { id: true, firstName: true, lastName: true, email: true, referralProfile: true },
    });

    if (byEmail) {
      return {
        found: true,
        referrerId: byEmail.id,
        name: `${byEmail.firstName} ${byEmail.lastName}`.trim(),
        method: 'email',
      };
    }

    // Try by phone
    const phoneQuery = trimmed.startsWith('+91') ? trimmed : `+91${trimmed.replace(/\D/g, '')}`;
    const byPhone = await this.prisma.applicant.findFirst({
      where: { phone: phoneQuery },
      select: { id: true, firstName: true, lastName: true, email: true, referralProfile: true },
    });

    if (byPhone) {
      return {
        found: true,
        referrerId: byPhone.id,
        name: `${byPhone.firstName} ${byPhone.lastName}`.trim(),
        method: 'phone',
      };
    }

    return { found: false, referrerId: null, name: null, method: null };
  }

  /**
   * Set the referrer on an applicant (called during/after application).
   */
  async setReferrer(applicantId: string, referrerId: string) {
    if (applicantId === referrerId) {
      throw new BadRequestException('You cannot refer yourself');
    }

    const applicant = await this.prisma.applicant.findUnique({ where: { id: applicantId } });
    if (!applicant) throw new NotFoundException('Applicant not found');

    if (applicant.referredById) {
      throw new ConflictException('This applicant already has a referrer set');
    }

    const referrer = await this.prisma.applicant.findUnique({ where: { id: referrerId } });
    if (!referrer) throw new NotFoundException('Referrer not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.applicant.update({
        where: { id: applicantId },
        data: { referredById: referrerId },
      });

      // Increment referral count if the referrer has a profile
      await tx.referralProfile.updateMany({
        where: { applicantId: referrerId },
        data: { totalReferrals: { increment: 1 } },
      });
    });

    this.logger.log(`Referral set: ${applicantId} referred by ${referrerId}`);
    return { success: true };
  }

  /**
   * Enable affiliate mode for an applicant — generates a unique referral code.
   */
  async enableAffiliate(applicantId: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: applicantId },
      include: { referralProfile: true },
    });

    if (!applicant) throw new NotFoundException('Applicant not found');

    if (applicant.referralProfile) {
      return {
        referralCode: applicant.referralProfile.referralCode,
        referralLink: this.buildReferralLink(applicant.referralProfile.referralCode),
        alreadyEnabled: true,
      };
    }

    // Generate a unique 8-character referral code
    const code = await this.generateUniqueCode(applicant.firstName);

    const profile = await this.prisma.referralProfile.create({
      data: {
        applicantId,
        referralCode: code,
      },
    });

    this.logger.log(`Affiliate enabled for ${applicantId}: ${code}`);

    return {
      referralCode: profile.referralCode,
      referralLink: this.buildReferralLink(profile.referralCode),
      alreadyEnabled: false,
    };
  }

  /**
   * Get referral profile for an applicant (their code, stats, and referrals list).
   */
  async getMyReferralProfile(applicantId: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: applicantId },
      include: {
        referralProfile: true,
        referredBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        referrals: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            appliedAt: true,
            city: true,
          },
          orderBy: { appliedAt: 'desc' },
        },
        badges: {
          include: { badge: true }
        },
        certificates: {
          orderBy: { createdAt: 'desc' }
        }
      },
    });

    if (!applicant) throw new NotFoundException('Applicant not found');

    return {
      isAffiliate: !!applicant.referralProfile,
      referralCode: applicant.referralProfile?.referralCode || null,
      referralLink: applicant.referralProfile
        ? this.buildReferralLink(applicant.referralProfile.referralCode)
        : null,
      totalReferrals: applicant.referralProfile?.totalReferrals || 0,
      referredBy: applicant.referredBy
        ? {
            id: applicant.referredBy.id,
            name: `${applicant.referredBy.firstName} ${applicant.referredBy.lastName}`.trim(),
            email: applicant.referredBy.email,
          }
        : null,
      referrals: applicant.referrals.map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`.trim(),
        email: r.email,
        status: r.status,
        appliedAt: r.appliedAt,
        city: r.city,
      })),
      badges: (applicant as any).badges?.map((ab: any) => ({
        id: ab.badge.id,
        name: ab.badge.name,
        description: ab.badge.description,
        icon: ab.badge.icon,
        issuedAt: ab.issuedAt,
      })) || [],
      certificates: (applicant as any).certificates?.map((c: any) => ({
        id: c.id,
        title: c.title,
        credentialId: c.credentialId,
        linkedinUrl: c.linkedinUrl,
        url: c.url,
        issueDate: c.issueDate,
      })) || [],
    };
  }

  // ─── Admin endpoints ────────────────────────────────

  /**
   * Get full referral analytics for admin dashboard.
   */
  async getAdminReferralStats() {
    const [totalReferrals, totalAffiliates, topReferrers] = await Promise.all([
      this.prisma.applicant.count({
        where: { referredById: { not: null } },
      }),
      this.prisma.referralProfile.count(),
      this.prisma.referralProfile.findMany({
        where: { totalReferrals: { gt: 0 } },
        orderBy: { totalReferrals: 'desc' },
        take: 50,
        include: {
          applicant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              city: true,
              status: true,
            },
          },
        },
      }),
    ]);

    return {
      totalReferrals,
      totalAffiliates,
      topReferrers: topReferrers.map((rp) => ({
        applicantId: rp.applicant.id,
        name: `${rp.applicant.firstName} ${rp.applicant.lastName}`.trim(),
        email: rp.applicant.email,
        phone: rp.applicant.phone,
        city: rp.applicant.city,
        status: rp.applicant.status,
        referralCode: rp.referralCode,
        totalReferrals: rp.totalReferrals,
        isActive: rp.isActive,
        createdAt: rp.createdAt,
      })),
    };
  }

  /**
   * Get detailed referral chain for a specific affiliate (admin view).
   */
  async getAffiliateDetail(applicantId: string) {
    const profile = await this.prisma.referralProfile.findUnique({
      where: { applicantId },
      include: {
        applicant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            city: true,
          },
        },
      },
    });

    if (!profile) throw new NotFoundException('Referral profile not found');

    const referredApplicants = await this.prisma.applicant.findMany({
      where: { referredById: applicantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        city: true,
        status: true,
        appliedAt: true,
        batch: { select: { batchNumber: true } },
        team: { select: { name: true } },
      },
      orderBy: { appliedAt: 'desc' },
    });

    return {
      affiliate: {
        ...profile.applicant,
        referralCode: profile.referralCode,
        isActive: profile.isActive,
        totalReferrals: profile.totalReferrals,
        createdAt: profile.createdAt,
      },
      referredApplicants: referredApplicants.map((a) => ({
        id: a.id,
        name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.email,
        phone: a.phone,
        city: a.city,
        status: a.status,
        appliedAt: a.appliedAt,
        batchNumber: a.batch?.batchNumber,
        teamName: a.team?.name,
      })),
    };
  }

  /**
   * Admin: toggle affiliate active status.
   */
  async toggleAffiliateStatus(applicantId: string, isActive: boolean) {
    const profile = await this.prisma.referralProfile.findUnique({
      where: { applicantId },
    });
    if (!profile) throw new NotFoundException('Referral profile not found');

    return this.prisma.referralProfile.update({
      where: { applicantId },
      data: { isActive },
    });
  }

  /**
   * Admin: get all referral records with filters.
   */
  async getAllReferrals(params: { page?: number; limit?: number; search?: string }) {
    const { page = 1, search } = params;
    // Clamp client-supplied limit to a sane range to prevent unbounded queries.
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { referredById: { not: null } };
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.applicant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { appliedAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          city: true,
          status: true,
          appliedAt: true,
          referredBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              referralProfile: { select: { referralCode: true } },
            },
          },
        },
      }),
      this.prisma.applicant.count({ where }),
    ]);

    return {
      data: data.map((a) => ({
        id: a.id,
        name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.email,
        phone: a.phone,
        city: a.city,
        status: a.status,
        appliedAt: a.appliedAt,
        referredBy: a.referredBy
          ? {
              id: a.referredBy.id,
              name: `${a.referredBy.firstName} ${a.referredBy.lastName}`.trim(),
              email: a.referredBy.email,
              referralCode: a.referredBy.referralProfile?.referralCode,
            }
          : null,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Helper methods ────────────────────────────────

  private async generateUniqueCode(firstName: string): Promise<string> {
    const prefix = (firstName || 'ARYA').substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X');
    let attempts = 0;

    while (attempts < 10) {
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      const code = `${prefix}${random}`;

      const existing = await this.prisma.referralProfile.findUnique({
        where: { referralCode: code },
      });

      if (!existing) return code;
      attempts++;
    }

    // Fallback: use timestamp
    const ts = Date.now().toString(36).toUpperCase().slice(-6);
    return `${prefix}${ts}`;
  }

  private buildReferralLink(code: string): string {
    const baseUrl = this.configService.get<string>('FRONTEND_URL', 'https://aryavartham.com');
    return `${baseUrl}/apply?ref=${code}`;
  }
}
