import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyStatus, EquityEventType } from '@prisma/client';

@Injectable()
export class EquityService {
  private readonly logger = new Logger(EquityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── COMPANY ENTITY OPERATIONS ────────────────────────────

  /** Create a company entity for a team and initialize equity structure */
  async createCompany(data: {
    teamId: string;
    companyName: string;
    sector?: string;
    description?: string;
    registrationNumber?: string;
    registeredAddress?: string;
    gstin?: string;
    panNumber?: string;
    notes?: string;
  }) {
    // Ensure team exists and doesn't already have a company
    const team = await this.prisma.team.findUnique({
      where: { id: data.teamId },
      include: {
        companyEntity: true,
        members: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!team) throw new NotFoundException('Team not found');
    if (team.companyEntity) throw new BadRequestException('Team already has a registered company entity');
    // Guard against forming a company with no members: the founders' 49% could not
    // be allocated, leaving the cap table summing to only 51% while still claiming
    // 49% to founders. Never create a company in this inconsistent state.
    if (team.members.length === 0) {
      throw new BadRequestException('Cannot form a company for a team with no members');
    }

    const PLATFORM_EQUITY = 51.0;
    const FOUNDERS_EQUITY = 49.0;

    // Create company + platform holder + one holder per team member in a transaction
    const company = await this.prisma.$transaction(async (tx) => {
      const entity = await tx.companyEntity.create({
        data: {
          teamId: data.teamId,
          companyName: data.companyName,
          sector: data.sector,
          description: data.description,
          registrationNumber: data.registrationNumber,
          registeredAddress: data.registeredAddress,
          gstin: data.gstin,
          panNumber: data.panNumber,
          notes: data.notes,
          platformEquityPct: PLATFORM_EQUITY,
          foundersEquityPct: FOUNDERS_EQUITY,
          status: 'FORMATION',
        },
      });

      // Create platform holder
      await tx.equityHolder.create({
        data: {
          companyId: entity.id,
          applicantId: null,
          holderName: 'Aryavartham Platform (SKSC MYSILLYDREAMS PVT LTD)',
          holderType: 'PLATFORM',
          equityPct: PLATFORM_EQUITY,
          vestedPct: PLATFORM_EQUITY, // Platform equity is fully vested
        },
      });

      // Split founders' equity equally among team members.
      // Use a largest-remainder allocation (round each share down to 2dp, then
      // distribute the leftover hundredths one-by-one) so the per-member shares
      // sum EXACTLY to FOUNDERS_EQUITY rather than drifting from independent rounding.
      const memberCount = team.members.length;
      if (memberCount > 0) {
        const memberShares = EquityService.largestRemainderSplit(FOUNDERS_EQUITY, memberCount);
        for (let i = 0; i < team.members.length; i++) {
          const member = team.members[i];
          await tx.equityHolder.create({
            data: {
              companyId: entity.id,
              applicantId: member.id,
              holderName: `${member.firstName} ${member.lastName || ''}`.trim(),
              holderType: 'FOUNDER',
              equityPct: memberShares[i],
              vestedPct: 0, // Founders start unvested
              vestingSchedule: {
                cliff: 90,      // 90-day cliff
                duration: 1000, // Full vesting over 1000 days
                intervals: 'monthly',
              },
            },
          });
        }
      }

      // Record GRANT event
      await tx.equityEvent.create({
        data: {
          companyId: entity.id,
          eventType: 'GRANT',
          fromHolder: null,
          toHolder: 'All Stakeholders',
          percentageAmount: 100,
          platformEquityAfter: PLATFORM_EQUITY,
          foundersEquityAfter: FOUNDERS_EQUITY,
          description: `Company "${data.companyName}" formed. Platform granted ${PLATFORM_EQUITY}% equity. Remaining ${FOUNDERS_EQUITY}% allocated to ${memberCount} founding members with 1000-day vesting schedule.`,
          triggeredBy: 'SYSTEM',
          dayNumber: 0,
        },
      });

      return entity;
    });

    this.logger.log(`Company created: ${data.companyName} for team ${data.teamId}`);
    return company;
  }

  /** Start the 1000-day timer for a company (activates the equity agreement) */
  async startTimer(companyId: string, adminId?: string) {
    const company = await this.prisma.companyEntity.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.timerStartDate) throw new BadRequestException('Timer already started');

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1000);

    const updated = await this.prisma.companyEntity.update({
      where: { id: companyId },
      data: {
        timerStartDate: startDate,
        timerEndDate: endDate,
        status: 'ACTIVE',
        daysElapsed: 0,
      },
    });

    // Log event
    await this.prisma.equityEvent.create({
      data: {
        companyId,
        eventType: 'GRANT',
        percentageAmount: 0,
        platformEquityAfter: company.platformEquityPct,
        foundersEquityAfter: company.foundersEquityPct,
        description: `1000-day equity timer started. Timer runs from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}.`,
        triggeredBy: adminId || 'SYSTEM',
        dayNumber: 0,
      },
    });

    this.logger.log(`Timer started for company ${companyId}: ${startDate.toISOString()} → ${endDate.toISOString()}`);
    return updated;
  }

  /** Execute the handover: transfer platform's 51% to founders */
  async executeHandover(companyId: string, adminId?: string) {
    const company = await this.prisma.companyEntity.findUnique({
      where: { id: companyId },
      include: {
        equityHolders: true,
      },
    });

    if (!company) throw new NotFoundException('Company not found');
    if (company.status === 'HANDED_OVER') throw new BadRequestException('Handover already completed');
    if (!company.timerStartDate) throw new BadRequestException('Timer not started — cannot hand over');

    const now = new Date();
    const dayNumber = Math.floor((now.getTime() - company.timerStartDate.getTime()) / (1000 * 60 * 60 * 24));

    // The platform's controlling 51% only vests after the full 1000-day period.
    // Without this guard the entire stake could be handed over on day 1.
    if (dayNumber < 1000) {
      throw new BadRequestException(
        `Handover not permitted before day 1000 (currently day ${dayNumber})`,
      );
    }

    const platformHolder = company.equityHolders.find(h => h.holderType === 'PLATFORM');
    const founderHolders = company.equityHolders.filter(h => h.holderType === 'FOUNDER' && h.isActive);

    if (!platformHolder) throw new BadRequestException('No platform equity holder found');
    if (founderHolders.length === 0) throw new BadRequestException('No active founder holders');

    const platformEquity = platformHolder.equityPct;
    // Distribute the platform's stake using a largest-remainder allocation so the
    // transferred shares sum EXACTLY to platformEquity (and founders' total to 100%),
    // instead of drifting because each per-founder share was rounded independently.
    const founderTransfers = EquityService.largestRemainderSplit(platformEquity, founderHolders.length);

    await this.prisma.$transaction(async (tx) => {
      // Zero out platform holder
      await tx.equityHolder.update({
        where: { id: platformHolder.id },
        data: { equityPct: 0, isActive: false },
      });

      // Distribute to founders
      for (let i = 0; i < founderHolders.length; i++) {
        const founder = founderHolders[i];
        const newPct = founder.equityPct + founderTransfers[i];
        await tx.equityHolder.update({
          where: { id: founder.id },
          data: {
            equityPct: newPct,
            vestedPct: newPct, // Fully vested after handover
          },
        });
      }

      // Update company status
      await tx.companyEntity.update({
        where: { id: companyId },
        data: {
          status: 'HANDED_OVER',
          platformEquityPct: 0,
          foundersEquityPct: 100,
          handoverDate: now,
          daysElapsed: dayNumber,
        },
      });

      // Record handover event
      await tx.equityEvent.create({
        data: {
          companyId,
          eventType: 'HANDOVER',
          fromHolder: 'Aryavartham Platform',
          toHolder: `${founderHolders.length} Founding Members`,
          percentageAmount: platformEquity,
          platformEquityAfter: 0,
          foundersEquityAfter: 100,
          description: `1000-day period completed (Day ${dayNumber}). Platform transferred ${platformEquity}% equity to ${founderHolders.length} founders (largest-remainder split). Per-founder additions: ${founderTransfers.join('%, ')}%.`,
          triggeredBy: adminId || 'SYSTEM',
          dayNumber,
        },
      });
    });

    this.logger.log(`Handover executed for company ${companyId} on day ${dayNumber}`);
    return { success: true, dayNumber, transferred: platformEquity };
  }

  /** Update the days-elapsed counter for all active companies (cron-friendly) */
  async updateTimers() {
    const activeCompanies = await this.prisma.companyEntity.findMany({
      where: {
        status: 'ACTIVE',
        timerStartDate: { not: null },
      },
    });

    const now = new Date();

    // Group companies by their computed elapsed-day value so we can issue one
    // updateMany() per distinct value instead of one UPDATE per company.
    const byElapsed = new Map<number, string[]>();
    for (const company of activeCompanies) {
      if (!company.timerStartDate) continue;
      const elapsed = Math.floor((now.getTime() - company.timerStartDate.getTime()) / (1000 * 60 * 60 * 24));
      const ids = byElapsed.get(elapsed);
      if (ids) ids.push(company.id);
      else byElapsed.set(elapsed, [company.id]);
    }

    if (byElapsed.size > 0) {
      await this.prisma.$transaction(
        Array.from(byElapsed.entries()).map(([elapsed, ids]) =>
          this.prisma.companyEntity.updateMany({
            where: { id: { in: ids } },
            data: { daysElapsed: elapsed },
          }),
        ),
      );
    }

    const updated = Array.from(byElapsed.values()).reduce((sum, ids) => sum + ids.length, 0);

    this.logger.log(`Updated timers for ${updated} active companies`);
    return { updated };
  }

  /** Get company details with full equity breakdown */
  async getCompanyDetail(companyId: string) {
    const company = await this.prisma.companyEntity.findUnique({
      where: { id: companyId },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            memberCount: true,
            batch: { select: { batchNumber: true } },
          },
        },
        equityHolders: {
          orderBy: { equityPct: 'desc' },
          include: {
            applicant: {
              select: { id: true, firstName: true, lastName: true, email: true, status: true },
            },
          },
        },
        equityAgreements: {
          orderBy: { createdAt: 'desc' },
        },
        equityEvents: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!company) throw new NotFoundException('Company not found');

    // Compute live days elapsed
    let liveElapsed = company.daysElapsed;
    if (company.timerStartDate && company.status === 'ACTIVE') {
      liveElapsed = Math.floor((new Date().getTime() - company.timerStartDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      ...company,
      daysElapsed: liveElapsed,
      daysRemaining: company.timerEndDate
        ? Math.max(0, Math.ceil((company.timerEndDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
        : null,
      progressPct: company.timerStartDate
        ? Math.min(100, Math.round((liveElapsed / 1000) * 100))
        : 0,
    };
  }

  /** List all companies with summary stats */
  async listCompanies(params: { status?: string; page?: number; limit?: number } = {}) {
    const MAX_LIMIT = 100;
    const page = params.page || 1;
    // Cap the client-supplied limit so a caller cannot request an unbounded page.
    const limit = Math.min(params.limit || 20, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;

    const [companies, total] = await Promise.all([
      this.prisma.companyEntity.findMany({
        where,
        include: {
          team: {
            select: { id: true, name: true, memberCount: true, batch: { select: { batchNumber: true } } },
          },
          _count: { select: { equityHolders: true, equityEvents: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.companyEntity.count({ where }),
    ]);

    return {
      data: companies,
      meta: { total, page, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Dashboard stats for admin equity overview */
  async getAdminStats() {
    const [totalCompanies, statusBreakdown, avgElapsed, upcomingHandovers] = await Promise.all([
      this.prisma.companyEntity.count(),
      this.prisma.companyEntity.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.companyEntity.aggregate({
        where: { status: 'ACTIVE' },
        _avg: { daysElapsed: true },
      }),
      this.prisma.companyEntity.findMany({
        where: {
          status: 'ACTIVE',
          timerEndDate: {
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Within 30 days
          },
        },
        include: {
          team: { select: { name: true } },
        },
        orderBy: { timerEndDate: 'asc' },
        take: 10,
      }),
    ]);

    return {
      totalCompanies,
      statusBreakdown: statusBreakdown.map(s => ({ status: s.status, count: s._count })),
      avgDaysElapsed: Math.round(avgElapsed._avg.daysElapsed || 0),
      upcomingHandovers: upcomingHandovers.map(c => ({
        id: c.id,
        companyName: c.companyName,
        teamName: c.team.name,
        timerEndDate: c.timerEndDate,
        daysRemaining: c.timerEndDate
          ? Math.max(0, Math.ceil((c.timerEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          : null,
      })),
    };
  }

  /** Update company details */
  async updateCompany(companyId: string, data: {
    companyName?: string;
    registrationNumber?: string;
    incorporationDate?: string;
    status?: CompanyStatus;
    sector?: string;
    description?: string;
    registeredAddress?: string;
    gstin?: string;
    panNumber?: string;
    notes?: string;
  }) {
    const company = await this.prisma.companyEntity.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    return this.prisma.companyEntity.update({
      where: { id: companyId },
      data: {
        ...(data.companyName && { companyName: data.companyName }),
        ...(data.registrationNumber !== undefined && { registrationNumber: data.registrationNumber }),
        ...(data.incorporationDate && { incorporationDate: new Date(data.incorporationDate) }),
        ...(data.status && { status: data.status }),
        ...(data.sector !== undefined && { sector: data.sector }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.registeredAddress !== undefined && { registeredAddress: data.registeredAddress }),
        ...(data.gstin !== undefined && { gstin: data.gstin }),
        ...(data.panNumber !== undefined && { panNumber: data.panNumber }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  // ─── AGREEMENT OPERATIONS ─────────────────────────────────

  /** Create a new equity agreement */
  async createAgreement(data: {
    companyId: string;
    agreementType: string;
    title: string;
    equityPct?: number;
    duration?: number;
    terms?: any;
    notes?: string;
  }) {
    const company = await this.prisma.companyEntity.findUnique({ where: { id: data.companyId } });
    if (!company) throw new NotFoundException('Company not found');

    return this.prisma.equityAgreement.create({
      data: {
        companyId: data.companyId,
        agreementType: data.agreementType,
        title: data.title,
        equityPct: data.equityPct,
        duration: data.duration,
        terms: data.terms,
        notes: data.notes,
      },
    });
  }

  /** Sign an agreement (platform side) */
  async signAgreementPlatform(agreementId: string, adminName: string) {
    const agreement = await this.prisma.equityAgreement.findUnique({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found');

    const update: any = {
      platformSignedAt: new Date(),
      platformSignedBy: adminName,
    };

    // If founder also signed, activate
    if (agreement.founderSignedAt) {
      update.status = 'ACTIVE';
      update.startDate = new Date();
      if (agreement.duration) {
        const end = new Date();
        end.setDate(end.getDate() + agreement.duration);
        update.endDate = end;
      }
    } else {
      update.status = 'PENDING_SIGNATURE';
    }

    return this.prisma.equityAgreement.update({ where: { id: agreementId }, data: update });
  }

  /** Sign an agreement (founder side) */
  async signAgreementFounder(agreementId: string, applicantId: string) {
    const agreement = await this.prisma.equityAgreement.findUnique({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found');

    const update: any = {
      founderSignedAt: new Date(),
      founderSignedBy: applicantId,
    };

    // If platform also signed, activate
    if (agreement.platformSignedAt) {
      update.status = 'ACTIVE';
      update.startDate = new Date();
      if (agreement.duration) {
        const end = new Date();
        end.setDate(end.getDate() + agreement.duration);
        update.endDate = end;
      }
    } else {
      update.status = 'PENDING_SIGNATURE';
    }

    return this.prisma.equityAgreement.update({ where: { id: agreementId }, data: update });
  }

  /** Record a custom equity event (e.g., dilution, external investment) */
  async recordEvent(data: {
    companyId: string;
    eventType: EquityEventType;
    fromHolder?: string;
    toHolder?: string;
    percentageAmount: number;
    description: string;
    metadata?: any;
    triggeredBy?: string;
  }) {
    const company = await this.prisma.companyEntity.findUnique({ where: { id: data.companyId } });
    if (!company) throw new NotFoundException('Company not found');

    const dayNumber = company.timerStartDate
      ? Math.floor((Date.now() - company.timerStartDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return this.prisma.equityEvent.create({
      data: {
        companyId: data.companyId,
        eventType: data.eventType,
        fromHolder: data.fromHolder,
        toHolder: data.toHolder,
        percentageAmount: data.percentageAmount,
        platformEquityAfter: company.platformEquityPct,
        foundersEquityAfter: company.foundersEquityPct,
        description: data.description,
        metadata: data.metadata,
        triggeredBy: data.triggeredBy || 'SYSTEM',
        dayNumber,
      },
    });
  }

  // ─── HELPERS ──────────────────────────────────────────────

  /**
   * Split a total percentage into `count` shares (rounded to 2 decimal places)
   * that sum EXACTLY to `total`, using the largest-remainder method.
   *
   * Each share is first floored to the nearest 0.01; the leftover hundredths are
   * then handed out one at a time to the shares with the largest fractional
   * remainder. This avoids the drift you get from rounding each share
   * independently (e.g. 49 / 3 → 16.33 × 3 = 48.99 ≠ 49).
   */
  private static largestRemainderSplit(total: number, count: number): number[] {
    if (count <= 0) return [];

    // Work in integer hundredths to avoid float accumulation error.
    const totalUnits = Math.round(total * 100);
    const base = Math.floor(totalUnits / count);
    let remainder = totalUnits - base * count; // leftover hundredths to distribute

    // Fractional remainder of each ideal share, used to order distribution.
    const fractions = Array.from({ length: count }, (_, i) => ({
      i,
      frac: (totalUnits / count) - base,
    }));
    // All ideal shares have the same fractional part here, so distribute by index
    // order (earliest holders first) — deterministic and stable.
    fractions.sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

    const units = new Array<number>(count).fill(base);
    for (let k = 0; k < remainder; k++) {
      units[fractions[k].i] += 1;
    }

    return units.map((u) => u / 100);
  }
}
