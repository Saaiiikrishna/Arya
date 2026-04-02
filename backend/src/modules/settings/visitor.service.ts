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
        // Total views in period (approximate using visitor count if precise view not needed, or parsing JSON)
        // Since we want total page views, we can query raw
        this.prisma.$queryRawUnsafe<{ total: number }[]>(`SELECT COALESCE(SUM(jsonb_array_length(history)), 0)::int as total FROM visitors WHERE last_visit_at >= '${since.toISOString()}'`).then(res => res[0]?.total || 0),

        // Unique sessions (Unique IPs)
        this.prisma.visitor.count({
          where: { lastVisitAt: { gte: since } },
        }),

        // Today's views
        this.prisma.$queryRawUnsafe<{ total: number }[]>(`SELECT COALESCE(SUM(jsonb_array_length(history)), 0)::int as total FROM visitors WHERE last_visit_at >= '${new Date(new Date().toISOString().split('T')[0]).toISOString()}'`).then(res => res[0]?.total || 0),

        // Top pages
        this.prisma.$queryRaw`
          SELECT arr.elem->>'path' as path, COUNT(*)::int as views,
                 COUNT(DISTINCT v.ip)::int as unique_sessions
          FROM visitors v,
          jsonb_array_elements(v.history) as arr(elem)
          WHERE v.last_visit_at >= ${since}
          GROUP BY arr.elem->>'path'
          ORDER BY views DESC
          LIMIT 10
        ` as Promise<any[]>,

        // Recent visitors (last 20)
        this.prisma.visitor.findMany({
          orderBy: { lastVisitAt: 'desc' },
          take: 20,
          select: {
            id: true,
            ip: true,
            country: true,
            city: true,
            browser: true,
            os: true,
            device: true,
            applicantName: true,
            applicantEmail: true,
            lastVisitAt: true,
            history: true,
          },
        }).then((v: any[]) => v.map((visitor: any) => {
            const hist = (visitor.history as any) || [];
            return {
              ...visitor,
              path: hist[hist.length - 1]?.path || '/', // Mock latest path for UI
              timestamp: visitor.lastVisitAt
            };
        })),
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
   * Paginated page views for admin detail table, aggregated by session/IP.
   */
  async getPageViews(filters: PageViewFilters) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));
    const skip = (page - 1) * limit;

    let searchFilter = '';
    let startFilter = '';
    let endFilter = '';
    let pathFilter = '';

    if (filters.search) {
      const search = `%${filters.search}%`;
      searchFilter = `AND (
        ip ILIKE '${search}' OR
        applicant_email ILIKE '${search}' OR
        applicant_name ILIKE '${search}' OR
        city ILIKE '${search}' OR
        country ILIKE '${search}' OR
        path ILIKE '${search}'
      )`;
    }

    if (filters.startDate) {
      startFilter = `AND last_visit_at >= '${new Date(filters.startDate).toISOString()}'`;
    }
    if (filters.endDate) {
      endFilter = `AND last_visit_at <= '${new Date(filters.endDate).toISOString()}'`;
    }
    if (filters.path) {
      pathFilter = `AND history::text ILIKE '%${filters.path}%'`;
    }

    const baseWhere = `WHERE 1=1 ${pathFilter} ${startFilter} ${endFilter} ${searchFilter}`;

    // Count total unique visitors
    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM visitors
      ${baseWhere}
    `;

    const dataQuery = `
      SELECT 
        id,
        ip,
        ip as "sessionId",
        country,
        city,
        region,
        browser,
        os,
        device,
        screen_width as "screenWidth",
        screen_height as "screenHeight",
        language,
        applicant_name as "applicantName",
        applicant_email as "applicantEmail",
        total_duration as duration,
        first_visit_at as "firstVisitAt",
        last_visit_at as timestamp,
        history
      FROM visitors
      ${baseWhere}
      ORDER BY last_visit_at DESC
      LIMIT ${limit} OFFSET ${skip}
    `;

    const [totalResult, dataRaw] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ total: number }[]>(countQuery),
      this.prisma.$queryRawUnsafe<any[]>(dataQuery),
    ]);

    const total = totalResult[0]?.total || 0;

    // Process paths array to aggregate identical paths with counts
    const data = dataRaw.map((row: any) => {
      const pathCounts: Record<string, number> = {};
      
      // history is already parsed JSON in prisma object, but via queryRawUnsafe it might be string/json
      const history = typeof row.history === 'string' ? JSON.parse(row.history) : row.history || [];
      if (Array.isArray(history)) {
        history.forEach((p: any) => {
          pathCounts[p.path] = (pathCounts[p.path] || 0) + 1;
        });
      }

      // Convert back to structured array
      const aggregatedPaths = Object.entries(pathCounts)
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count);

      return {
        ...row,
        history: undefined, // remove raw history to save bandwidth
        aggregatedPaths,
      };
    });

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
