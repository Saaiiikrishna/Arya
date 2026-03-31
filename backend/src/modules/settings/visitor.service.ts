import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma';
import * as geoip from 'geoip-lite';

export interface PageViewEvent {
  sessionId: string;
  path: string;
  referrer?: string;
  screenWidth?: number;
  screenHeight?: number;
  language?: string;
  // Populated server-side
  ip?: string;
  userAgent?: string;
  // Populated if user is logged in
  applicantId?: string;
  applicantEmail?: string;
  applicantName?: string;
}

interface PageViewFilters {
  page?: number;
  limit?: number;
  path?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

@Injectable()
export class VisitorService {
  private readonly logger = new Logger(VisitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('visitor-queue') private readonly visitorQueue: Queue,
  ) {}

  /**
   * Enqueue a page view event for batch processing (no direct DB write).
   */
  async trackPageView(event: PageViewEvent): Promise<void> {
    // Resolve geo from IP
    const geo = event.ip ? geoip.lookup(event.ip) : null;

    // Parse user agent for browser/os/device
    const uaParsed = this.parseUserAgent(event.userAgent || '');

    const enrichedEvent = {
      ...event,
      country: geo?.country || null,
      city: geo?.city || null,
      region: geo?.region || null,
      browser: uaParsed.browser,
      os: uaParsed.os,
      device: uaParsed.device,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.visitorQueue.add('page-view', enrichedEvent, {
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch (error) {
      this.logger.warn('Failed to enqueue page view (Redis unavailable): ' + (error as any)?.message);
    }
  }

  /**
   * Get visitor summary for admin dashboard.
   */
  async getSummary(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [totalViews, uniqueSessions, todayViews, topPages, recentVisitors] =
      await Promise.all([
        // Total views in period
        this.prisma.pageView.count({
          where: { timestamp: { gte: since } },
        }),

        // Unique sessions
        this.prisma.pageView
          .findMany({
            where: { timestamp: { gte: since } },
            distinct: ['sessionId'],
            select: { sessionId: true },
          })
          .then((r) => r.length),

        // Today's views
        this.prisma.pageView.count({
          where: {
            timestamp: {
              gte: new Date(new Date().toISOString().split('T')[0]),
            },
          },
        }),

        // Top pages
        this.prisma.$queryRaw`
          SELECT path, COUNT(*)::int as views,
                 COUNT(DISTINCT session_id)::int as unique_sessions
          FROM page_views
          WHERE timestamp >= ${since}
          GROUP BY path
          ORDER BY views DESC
          LIMIT 10
        ` as Promise<any[]>,

        // Recent visitors (last 20)
        this.prisma.pageView.findMany({
          orderBy: { timestamp: 'desc' },
          take: 20,
          select: {
            id: true,
            sessionId: true,
            path: true,
            ip: true,
            country: true,
            city: true,
            browser: true,
            os: true,
            device: true,
            applicantName: true,
            applicantEmail: true,
            timestamp: true,
          },
        }),
      ]);

    // Daily trend (last N days from aggregated stats)
    const dailyTrend = await this.prisma.dailyPageStat.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    // Roll up daily trend by date
    const trendByDate: Record<string, { views: number; uniqueIps: number }> = {};
    for (const stat of dailyTrend) {
      const dateStr = stat.date.toISOString().split('T')[0];
      if (!trendByDate[dateStr]) {
        trendByDate[dateStr] = { views: 0, uniqueIps: 0 };
      }
      trendByDate[dateStr].views += stat.views;
      trendByDate[dateStr].uniqueIps += stat.uniqueIps;
    }

    return {
      totalViews,
      uniqueSessions,
      todayViews,
      topPages,
      recentVisitors,
      dailyTrend: Object.entries(trendByDate).map(([date, data]) => ({
        date,
        ...data,
      })),
    };
  }

  /**
   * Paginated page views for admin detail table.
   */
  async getPageViews(filters: PageViewFilters) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.path) {
      where.path = { contains: filters.path, mode: 'insensitive' };
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = new Date(filters.startDate);
      if (filters.endDate) where.timestamp.lte = new Date(filters.endDate);
    }

    if (filters.search) {
      where.OR = [
        { ip: { contains: filters.search, mode: 'insensitive' } },
        { applicantEmail: { contains: filters.search, mode: 'insensitive' } },
        { applicantName: { contains: filters.search, mode: 'insensitive' } },
        { city: { contains: filters.search, mode: 'insensitive' } },
        { country: { contains: filters.search, mode: 'insensitive' } },
        { path: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.pageView.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.pageView.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lightweight user-agent parser (no external dependency).
   */
  private parseUserAgent(ua: string): {
    browser: string;
    os: string;
    device: string;
  } {
    let browser = 'Unknown';
    let os = 'Unknown';
    let device = 'desktop';

    // Browser detection
    if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/')) browser = 'Safari';

    // OS detection
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    // Device detection
    if (ua.includes('Mobile') || ua.includes('Android') || ua.includes('iPhone'))
      device = 'mobile';
    else if (ua.includes('iPad') || ua.includes('Tablet')) device = 'tablet';

    return { browser, os, device };
  }
}
