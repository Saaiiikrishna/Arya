import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationService } from '../notifications/notification.service';

export const REWARD_CRITERIA = {
  REFERRAL_TIER_1: 5,   // "Tribe Builder"
  REFERRAL_TIER_2: 25,  // "Ecosystem Architect"
  REFERRAL_TIER_3: 100, // "Vikasit Bharath Catalyst"
};

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Check and award badges based on referral count
   */
  async checkReferralMilestones(applicantId: string) {
    try {
      const applicant = await this.prisma.applicant.findUnique({
        where: { id: applicantId },
        include: { 
          referrals: true,
          badges: { include: { badge: true } }
        },
      });

      if (!applicant) return;

      const referralCount = applicant.referrals.length;
      
      // Tier 1: Tribe Builder
      if (referralCount >= REWARD_CRITERIA.REFERRAL_TIER_1) {
        await this.awardBadge(applicantId, 'Tribe Builder', 'Awarded for building a community of 5+ founders.');
      }

      // Tier 2: Ecosystem Architect
      if (referralCount >= REWARD_CRITERIA.REFERRAL_TIER_2) {
        await this.awardBadge(applicantId, 'Ecosystem Architect', 'Awarded for architecting a massive network of 25+ visionaries.');
      }
      
      // Tier 3: Catalyst
      if (referralCount >= REWARD_CRITERIA.REFERRAL_TIER_3) {
        await this.awardBadge(applicantId, 'Vikasit Bharath Catalyst', 'The highest honor for driving large-scale participation in the 2047 vision.');
      }

    } catch (error) {
      this.logger.error(`Failed to check referral milestones for ${applicantId}`, error);
    }
  }

  private async awardBadge(applicantId: string, badgeName: string, description: string) {
    // Check if already awarded
    const existing = await this.prisma.applicantBadge.findFirst({
      where: {
        applicantId,
        badge: { name: badgeName }
      }
    });

    if (existing) return;

    // Get or create badge
    let badge = await this.prisma.badge.findUnique({ where: { name: badgeName } });
    if (!badge) {
      badge = await this.prisma.badge.create({
        data: { name: badgeName, description }
      });
    }

    // Award it
    await this.prisma.applicantBadge.create({
      data: {
        applicantId,
        badgeId: badge.id
      }
    });

    this.logger.log(`Awarded badge ${badgeName} to applicant ${applicantId}`);

    // Notify via WhatsApp + email
    const applicant = await this.prisma.applicant.findUnique({ where: { id: applicantId } });
    if (applicant) {
      const referralCount = await this.getReferralCount(applicantId);

      if (applicant.phone) {
        await this.whatsappService.sendReferralMilestone(
          applicant.phone,
          applicant.firstName,
          referralCount,
          badgeName,
          applicantId
        );
      }

      // Email side of the referral milestone (best-effort, never throws)
      await this.notifications.referralMilestoneEmail(
        { id: applicant.id, email: applicant.email, firstName: applicant.firstName },
        referralCount,
        badgeName,
      );
    }
  }

  private async getReferralCount(applicantId: string): Promise<number> {
    return this.prisma.applicant.count({
      where: { referredById: applicantId }
    });
  }
}
