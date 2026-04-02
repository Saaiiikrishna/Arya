import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma';

@Processor('visitor-queue')
export class VisitorProcessor extends WorkerHost {
  private readonly logger = new Logger(VisitorProcessor.name);
  private buffer: any[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL = 10_000; // 10 seconds

  constructor(private readonly prisma: PrismaService) {
    super();
    this.startFlushTimer();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'page-view':
        return this.handlePageView(job.data);
      case 'aggregate-daily':
        return this.handleAggregateDaily(job.data);
      case 'cleanup-old':
        return this.handleCleanup();
      default:
        this.logger.warn(`Unknown visitor job: ${job.name}`);
    }
  }

  /**
   * Buffer page view events and flush in batches.
   */
  private async handlePageView(data: any) {
    this.buffer.push({
      sessionId: data.sessionId,
      path: data.path,
      referrer: data.referrer || null,
      ip: data.ip || null,
      country: data.country || null,
      city: data.city || null,
      region: data.region || null,
      userAgent: data.userAgent || null,
      browser: data.browser || null,
      os: data.os || null,
      device: data.device || null,
      screenWidth: data.screenWidth || null,
      screenHeight: data.screenHeight || null,
      language: data.language || null,
      applicantId: data.applicantId || null,
      applicantEmail: data.applicantEmail || null,
      applicantName: data.applicantName || null,
      duration: data.duration || 0,
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
    });

    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flushBuffer();
    }
  }

  /**
   * Flush buffered page views to DB as aggregated Visitor upserts.
   */
  private async flushBuffer() {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    // Aggregate by sessionId to avoid race conditions
    const aggregatedBySession: Record<string, { hits: any[]; latest: any }> = {};

    for (const item of batch) {
      const sessionId = item.sessionId;
      if (!sessionId) continue; // fallback to session if no IP
      if (!aggregatedBySession[sessionId]) {
        aggregatedBySession[sessionId] = { hits: [], latest: item };
      } else {
        aggregatedBySession[sessionId].latest = {
          ...aggregatedBySession[sessionId].latest,
          ...item,
          applicantId: item.applicantId || aggregatedBySession[sessionId].latest.applicantId,
          applicantEmail: item.applicantEmail || aggregatedBySession[sessionId].latest.applicantEmail,
          applicantName: item.applicantName || aggregatedBySession[sessionId].latest.applicantName,
        };
      }
      aggregatedBySession[sessionId].hits.push({
        path: item.path,
        timestamp: item.timestamp.toISOString(),
        duration: item.duration || 0,
      });
    }

    try {
      for (const [sessionId, data] of Object.entries(aggregatedBySession)) {
        const existing = await this.prisma.visitor.findUnique({ where: { sessionId } });
        
        const history: any[] = (existing?.history as any[]) || [];
        history.push(...data.hits);
        
        // Exact duration in seconds between earliest known hit and most recent hit
        const firstVisitAt = existing ? existing.firstVisitAt : new Date(data.hits[0].timestamp);
        const lastVisitAt = new Date(data.latest.timestamp);
        const totalDuration = Math.floor((lastVisitAt.getTime() - firstVisitAt.getTime()) / 1000);

        await this.prisma.visitor.upsert({
          where: { sessionId },
          create: {
            sessionId,
            ip: data.latest.ip || '',
            history,
            totalDuration,
            country: data.latest.country,
            city: data.latest.city,
            region: data.latest.region,
            userAgent: data.latest.userAgent,
            browser: data.latest.browser,
            os: data.latest.os,
            device: data.latest.device,
            screenWidth: data.latest.screenWidth,
            screenHeight: data.latest.screenHeight,
            language: data.latest.language,
            applicantId: data.latest.applicantId,
            applicantEmail: data.latest.applicantEmail,
            applicantName: data.latest.applicantName,
            firstVisitAt,
            lastVisitAt,
          },
          update: {
            history,
            totalDuration,
            country: data.latest.country || existing?.country,
            city: data.latest.city || existing?.city,
            region: data.latest.region || existing?.region,
            userAgent: data.latest.userAgent || existing?.userAgent,
            browser: data.latest.browser || existing?.browser,
            os: data.latest.os || existing?.os,
            device: data.latest.device || existing?.device,
            screenWidth: data.latest.screenWidth || existing?.screenWidth,
            screenHeight: data.latest.screenHeight || existing?.screenHeight,
            language: data.latest.language || existing?.language,
            applicantId: data.latest.applicantId || existing?.applicantId,
            applicantEmail: data.latest.applicantEmail || existing?.applicantEmail,
            applicantName: data.latest.applicantName || existing?.applicantName,
            lastVisitAt,
          }
        });
      }
      this.logger.debug(`Flushed ${batch.length} hits into ${Object.keys(aggregatedBySession).length} visitors`);
    } catch (error: any) {
      this.logger.error(`Failed to flush visitor buffers: ${error.message}`);
      if (this.buffer.length < 500) {
        this.buffer.push(...batch);
      }
    }
  }

  /**
   * Timer-based flush to ensure events don't sit in buffer too long.
   */
  private startFlushTimer() {
    this.flushTimer = setInterval(async () => {
      await this.flushBuffer();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Aggregate raw page views into DailyPageStat summaries.
   * Run daily via scheduled job.
   */
  private async handleAggregateDaily(data?: { date?: string }) {
    const targetDate = data?.date
      ? new Date(data.date)
      : new Date(Date.now() - 86400000); // Yesterday by default

    const dateStr = targetDate.toISOString().split('T')[0];
    const dayStart = new Date(dateStr + 'T00:00:00.000Z');
    const dayEnd = new Date(dateStr + 'T23:59:59.999Z');

    this.logger.log(`Aggregating daily stats for ${dateStr}`);

    // Get path-level aggregates using json unnesting
    const pathStats: any[] = await this.prisma.$queryRaw`
      SELECT
        arr.elem->>'path' as path,
        COUNT(*)::int as views,
        COUNT(DISTINCT v.ip)::int as unique_ips,
        AVG(CAST(COALESCE(arr.elem->>'duration', '0') AS FLOAT))::float as avg_duration
      FROM visitors v,
      jsonb_array_elements(v.history) as arr(elem)
      WHERE CAST(arr.elem->>'timestamp' AS timestamp) >= ${dayStart} 
        AND CAST(arr.elem->>'timestamp' AS timestamp) <= ${dayEnd}
      GROUP BY arr.elem->>'path'
    `;

    for (const stat of pathStats) {
      if (!stat.path) continue;
      await this.prisma.dailyPageStat.upsert({
        where: {
          date_path: { date: dayStart, path: stat.path },
        },
        create: {
          date: dayStart,
          path: stat.path,
          views: stat.views,
          uniqueIps: stat.unique_ips,
          avgDuration: stat.avg_duration,
        },
        update: {
          views: stat.views,
          uniqueIps: stat.unique_ips,
          avgDuration: stat.avg_duration,
        },
      });
    }

    this.logger.log(
      `Aggregated ${pathStats.length} path stats for ${dateStr}`,
    );
    return { date: dateStr, pathsProcessed: pathStats.length };
  }

  /**
   * Clean up raw visitors older than 90 days.
   * Assumes daily aggregates are already computed.
   */
  private async handleCleanup() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    this.logger.log(`Cleaning up visitors older than ${cutoff.toISOString()}`);

    const result = await this.prisma.visitor.deleteMany({
      where: { lastVisitAt: { lt: cutoff } },
    });

    this.logger.log(`Deleted ${result.count} old visitor records`);
    return { deleted: result.count };
  }

  /**
   * Cleanup on module destroy (flush remaining buffer).
   */
  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushBuffer();
  }
}
