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
      duration: data.duration || null,
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
    });

    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flushBuffer();
    }
  }

  /**
   * Flush buffered page views to DB in a single createMany call.
   */
  private async flushBuffer() {
    if (this.buffer.length === 0) return;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.prisma.pageView.createMany({ data: batch });
      this.logger.debug(`Flushed ${batch.length} page views to DB`);
    } catch (error) {
      this.logger.error(`Failed to flush page views: ${error.message}`);
      // Push back failed items (up to a limit to avoid infinite growth)
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

    // Get path-level aggregates using raw SQL for efficiency
    const pathStats: any[] = await this.prisma.$queryRaw`
      SELECT
        path,
        COUNT(*)::int as views,
        COUNT(DISTINCT ip)::int as unique_ips,
        AVG(duration)::float as avg_duration
      FROM page_views
      WHERE timestamp >= ${dayStart} AND timestamp <= ${dayEnd}
      GROUP BY path
    `;

    for (const stat of pathStats) {
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
   * Clean up raw page views older than 90 days.
   * Assumes daily aggregates are already computed.
   */
  private async handleCleanup() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    this.logger.log(`Cleaning up page views older than ${cutoff.toISOString()}`);

    const result = await this.prisma.pageView.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });

    this.logger.log(`Deleted ${result.count} old page view records`);
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
