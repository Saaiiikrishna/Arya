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

    // The 1000-day equity timer may only start after the team has completed BOTH
    // 90-day sprints (the first 180 days). Gate on completed sprint count.
    const completedSprints = await this.prisma.sprint.count({
      where: { teamId: company.teamId, status: 'COMPLETED' },
    });
    if (completedSprints < 2) {
      throw new BadRequestException('Both 90-day sprints must be completed before the equity timer can start.');
    }

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

  /**
   * Record a custom equity event AND mutate the cap table accordingly.
   *
   * Holders may be targeted precisely by id (fromHolderId/toHolderId); otherwise
   * we fall back to matching the active EquityHolder.holderName within the company.
   * All percentage arithmetic is done in integer hundredths of a percent to avoid
   * float drift, and the active holders' equityPct is asserted to sum to exactly
   * 100% after every mutation.
   */
  async recordEvent(data: {
    companyId: string;
    eventType: EquityEventType;
    fromHolder?: string;
    toHolder?: string;
    fromHolderId?: string;
    toHolderId?: string;
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

    // Amount being moved/granted, in integer hundredths of a percent.
    const amountUnits = Math.round((data.percentageAmount || 0) * 100);

    return this.prisma.$transaction(async (tx) => {
      const holders = await tx.equityHolder.findMany({ where: { companyId: data.companyId } });
      const activeHolders = holders.filter((h) => h.isActive);

      // Resolve a holder by explicit id, else by (active) holder name.
      const resolve = (id?: string, name?: string, label?: string) => {
        if (id) {
          const byId = holders.find((h) => h.id === id);
          if (!byId) throw new BadRequestException(`Unknown ${label || 'holder'} (id: ${id})`);
          return byId;
        }
        if (name) {
          const matches = activeHolders.filter((h) => h.holderName === name);
          if (matches.length === 0) throw new BadRequestException(`Unknown ${label || 'holder'} "${name}"`);
          if (matches.length > 1) {
            throw new BadRequestException(`Ambiguous ${label || 'holder'} "${name}"; specify by id`);
          }
          return matches[0];
        }
        return null;
      };

      // unit map keyed by holder id, in integer hundredths of a percent
      const unitsById = new Map<string, number>();
      for (const h of holders) unitsById.set(h.id, Math.round(h.equityPct * 100));

      const fromHolder = resolve(data.fromHolderId, data.fromHolder, 'source holder');
      const toHolder = resolve(data.toHolderId, data.toHolder, 'target holder');

      // Vesting overrides applied by this event (VEST), in integer hundredths.
      const vestUnitsById = new Map<string, number>();

      switch (data.eventType) {
        case 'TRANSFER': {
          if (!fromHolder) throw new BadRequestException('TRANSFER requires a source holder');
          if (!toHolder) throw new BadRequestException('TRANSFER requires a target holder');
          if (fromHolder.id === toHolder.id) throw new BadRequestException('Source and target holders must differ');
          if (amountUnits <= 0) throw new BadRequestException('TRANSFER amount must be positive');
          const fromUnits = unitsById.get(fromHolder.id) ?? 0;
          if (fromUnits < amountUnits) {
            throw new BadRequestException(`Source holder has insufficient equity (${fromUnits / 100}% < ${data.percentageAmount}%)`);
          }
          unitsById.set(fromHolder.id, fromUnits - amountUnits);
          unitsById.set(toHolder.id, (unitsById.get(toHolder.id) ?? 0) + amountUnits);
          break;
        }

        case 'BUYOUT': {
          if (!fromHolder) throw new BadRequestException('BUYOUT requires a source holder');
          const fromUnits = unitsById.get(fromHolder.id) ?? 0;
          if (fromUnits <= 0) throw new BadRequestException('Source holder has no equity to buy out');
          // Zero the source holder.
          unitsById.set(fromHolder.id, 0);
          if (toHolder) {
            if (toHolder.id === fromHolder.id) throw new BadRequestException('Source and target holders must differ');
            unitsById.set(toHolder.id, (unitsById.get(toHolder.id) ?? 0) + fromUnits);
          } else {
            // Distribute to remaining active holders via largest-remainder split.
            const recipients = activeHolders.filter((h) => h.id !== fromHolder.id);
            if (recipients.length === 0) throw new BadRequestException('No remaining active holders to absorb the buyout');
            const splitUnits = EquityService.largestRemainderUnits(fromUnits, recipients.length);
            for (let i = 0; i < recipients.length; i++) {
              unitsById.set(recipients[i].id, (unitsById.get(recipients[i].id) ?? 0) + splitUnits[i]);
            }
          }
          break;
        }

        case 'DILUTE': {
          if (!toHolder) throw new BadRequestException('DILUTE requires a target holder to receive the freed equity');
          if (amountUnits <= 0) throw new BadRequestException('DILUTE amount must be positive');
          // Reduce all active holders proportionally to free `amountUnits`, then grant to target.
          const diluted = activeHolders.filter((h) => h.id !== toHolder.id);
          const dilutedTotal = diluted.reduce((sum, h) => sum + (unitsById.get(h.id) ?? 0), 0);
          if (dilutedTotal < amountUnits) {
            throw new BadRequestException('Insufficient equity among other holders to dilute');
          }
          // Largest-remainder reduction so removed units sum EXACTLY to amountUnits.
          const reductions = EquityService.largestRemainderProportional(
            amountUnits,
            diluted.map((h) => unitsById.get(h.id) ?? 0),
          );
          for (let i = 0; i < diluted.length; i++) {
            unitsById.set(diluted[i].id, (unitsById.get(diluted[i].id) ?? 0) - reductions[i]);
          }
          unitsById.set(toHolder.id, (unitsById.get(toHolder.id) ?? 0) + amountUnits);
          break;
        }

        case 'VEST': {
          if (!toHolder) throw new BadRequestException('VEST requires a target holder');
          if (amountUnits <= 0) throw new BadRequestException('VEST amount must be positive');
          // Vesting does not change equityPct; it raises vestedPct, capped at equityPct.
          const equityUnits = unitsById.get(toHolder.id) ?? 0;
          const newVested = Math.min(equityUnits, Math.round(toHolder.vestedPct * 100) + amountUnits);
          vestUnitsById.set(toHolder.id, newVested);
          break;
        }

        default:
          // GRANT / HANDOVER and any other types: no cap-table mutation here
          // (handover has its own dedicated path). Audit only.
          break;
      }

      // For events that alter equityPct, assert the active holders still sum to 100%.
      // Any holder with >0 resulting units is active; one reduced to 0 is inactive.
      const mutatesEquity = data.eventType === 'TRANSFER' || data.eventType === 'BUYOUT' || data.eventType === 'DILUTE';
      if (mutatesEquity) {
        const activeSum = holders.reduce((sum, h) => {
          const units = unitsById.get(h.id) ?? 0;
          return sum + (units > 0 ? units : 0);
        }, 0);
        if (activeSum !== 10000) {
          throw new BadRequestException(`Cap table would not sum to 100% (got ${activeSum / 100}%)`);
        }
      }

      // Persist holder mutations.
      for (const h of holders) {
        const update: { equityPct?: number; vestedPct?: number; isActive?: boolean } = {};
        const newUnits = unitsById.get(h.id) ?? 0;
        const newPct = newUnits / 100;

        if (mutatesEquity && newPct !== h.equityPct) {
          update.equityPct = newPct;
          // vestedPct can never exceed equityPct.
          if (h.vestedPct > newPct) update.vestedPct = newPct;
        }
        // Derive active state from resulting equity for equity-mutating events.
        if (mutatesEquity) {
          const shouldBeActive = newUnits > 0;
          if (shouldBeActive !== h.isActive) update.isActive = shouldBeActive;
        }
        if (vestUnitsById.has(h.id)) {
          update.vestedPct = (vestUnitsById.get(h.id) ?? 0) / 100;
        }

        if (Object.keys(update).length > 0) {
          await tx.equityHolder.update({ where: { id: h.id }, data: update });
        }
      }

      // Recompute company platform/founders aggregates from the (post-mutation) holders.
      let platformAfter = company.platformEquityPct;
      let foundersAfter = company.foundersEquityPct;
      if (mutatesEquity) {
        let platformUnits = 0;
        let foundersUnits = 0;
        for (const h of holders) {
          const units = unitsById.get(h.id) ?? 0;
          if (units <= 0) continue;
          if (h.holderType === 'PLATFORM') platformUnits += units;
          else foundersUnits += units;
        }
        platformAfter = platformUnits / 100;
        foundersAfter = foundersUnits / 100;
        await tx.companyEntity.update({
          where: { id: data.companyId },
          data: { platformEquityPct: platformAfter, foundersEquityPct: foundersAfter },
        });
      }

      // Write the audit row.
      return tx.equityEvent.create({
        data: {
          companyId: data.companyId,
          eventType: data.eventType,
          fromHolder: data.fromHolder ?? fromHolder?.holderName ?? null,
          toHolder: data.toHolder ?? toHolder?.holderName ?? null,
          percentageAmount: data.percentageAmount,
          platformEquityAfter: platformAfter,
          foundersEquityAfter: foundersAfter,
          description: data.description,
          metadata: data.metadata,
          triggeredBy: data.triggeredBy || 'SYSTEM',
          dayNumber,
        },
      });
    });
  }

  // ─── VESTING OPERATIONS ───────────────────────────────────

  /**
   * Recompute each FOUNDER holder's vestedPct from its vestingSchedule and the
   * company's timerStartDate. PLATFORM holders remain fully vested.
   */
  async computeVesting(companyId: string) {
    const company = await this.prisma.companyEntity.findUnique({
      where: { id: companyId },
      include: { equityHolders: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const now = Date.now();
    const daysElapsed = company.timerStartDate
      ? Math.max(0, Math.floor((now - company.timerStartDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const updates: { id: string; vestedPct: number }[] = [];

    for (const holder of company.equityHolders) {
      if (!holder.isActive) continue;

      let newVested: number;
      if (holder.holderType === 'PLATFORM') {
        // Platform equity is always fully vested.
        newVested = holder.equityPct;
      } else if (holder.holderType === 'FOUNDER') {
        const schedule = (holder.vestingSchedule as any) || {};
        const cliff = typeof schedule.cliff === 'number' ? schedule.cliff : 90;
        const duration = typeof schedule.duration === 'number' ? schedule.duration : 1000;

        if (daysElapsed < cliff) {
          newVested = 0;
        } else {
          const monthsElapsed = Math.floor(daysElapsed / 30);
          const totalMonths = Math.ceil(duration / 30);
          const fraction = totalMonths > 0 ? Math.min(1, monthsElapsed / totalMonths) : 1;
          newVested = Math.round(holder.equityPct * fraction * 100) / 100;
        }
      } else {
        // Other holder types (e.g. INVESTOR): leave untouched.
        continue;
      }

      if (newVested !== holder.vestedPct) {
        updates.push({ id: holder.id, vestedPct: newVested });
      }
    }

    if (updates.length > 0) {
      await this.prisma.$transaction(
        updates.map((u) =>
          this.prisma.equityHolder.update({ where: { id: u.id }, data: { vestedPct: u.vestedPct } }),
        ),
      );
    }

    this.logger.log(`Recomputed vesting for company ${companyId}: ${updates.length} holder(s) updated (day ${daysElapsed})`);
    return {
      companyId,
      daysElapsed,
      updatedCount: updates.length,
      holders: updates,
    };
  }

  /**
   * Admin override of a holder's vested percentage. Validates the bound
   * (0 <= vestedPct <= equityPct), persists it, and logs a VEST audit event.
   */
  async setHolderVesting(holderId: string, vestedPct: number, triggeredBy?: string) {
    const holder = await this.prisma.equityHolder.findUnique({
      where: { id: holderId },
      include: { company: true },
    });
    if (!holder) throw new NotFoundException('Equity holder not found');

    if (typeof vestedPct !== 'number' || !Number.isFinite(vestedPct)) {
      throw new BadRequestException('vestedPct must be a number');
    }
    if (vestedPct < 0 || vestedPct > holder.equityPct) {
      throw new BadRequestException(`vestedPct must be between 0 and ${holder.equityPct} (the holder's equity)`);
    }

    const dayNumber = holder.company.timerStartDate
      ? Math.floor((Date.now() - holder.company.timerStartDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.equityHolder.update({
        where: { id: holderId },
        data: { vestedPct },
      });

      await tx.equityEvent.create({
        data: {
          companyId: holder.companyId,
          eventType: 'VEST',
          fromHolder: null,
          toHolder: holder.holderName,
          percentageAmount: vestedPct,
          platformEquityAfter: holder.company.platformEquityPct,
          foundersEquityAfter: holder.company.foundersEquityPct,
          description: `Admin override: ${holder.holderName} vested set to ${vestedPct}% (of ${holder.equityPct}% equity).`,
          triggeredBy: triggeredBy || 'SYSTEM',
          dayNumber,
        },
      });

      return updated;
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

  /**
   * Split `totalUnits` integer units evenly into `count` shares that sum EXACTLY
   * to `totalUnits` (largest-remainder, distributing leftover units to the earliest
   * indices). Works directly in integer hundredths-of-a-percent units.
   */
  private static largestRemainderUnits(totalUnits: number, count: number): number[] {
    if (count <= 0) return [];
    const base = Math.floor(totalUnits / count);
    const remainder = totalUnits - base * count;
    const units = new Array<number>(count).fill(base);
    for (let k = 0; k < remainder; k++) units[k] += 1;
    return units;
  }

  /**
   * Distribute a `reductionUnits` total across the given `weights` (integer units)
   * proportionally to each weight, returning integer reductions that sum EXACTLY
   * to `reductionUnits`. Uses largest-remainder on the fractional parts. No single
   * reduction exceeds its weight (caller must ensure sum(weights) >= reductionUnits).
   */
  private static largestRemainderProportional(reductionUnits: number, weights: number[]): number[] {
    const n = weights.length;
    if (n === 0) return [];
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight <= 0) return new Array<number>(n).fill(0);

    const exact = weights.map((w) => (reductionUnits * w) / totalWeight);
    const floors = exact.map((x) => Math.floor(x));
    let distributed = floors.reduce((s, x) => s + x, 0);
    let leftover = reductionUnits - distributed;

    // Order by largest fractional part, then by index for determinism.
    const order = exact
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

    const result = floors.slice();
    for (let k = 0; k < leftover; k++) {
      result[order[k % n].i] += 1;
    }
    return result;
  }
}
