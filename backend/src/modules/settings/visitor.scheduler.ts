import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Scheduled tasks for visitor analytics:
 * - Daily aggregation at 2:00 AM
 * - Monthly cleanup of raw records older than 90 days
 */
@Injectable()
export class VisitorScheduler {
  private readonly logger = new Logger(VisitorScheduler.name);

  constructor(
    @InjectQueue('visitor-queue') private readonly visitorQueue: Queue,
  ) {}

  /**
   * Aggregate yesterday's page views into DailyPageStat at 2:00 AM daily.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async aggregateDaily() {
    this.logger.log('Scheduling daily page view aggregation...');
    await this.visitorQueue.add('aggregate-daily', {}, {
      removeOnComplete: true,
      removeOnFail: 5,
    });
  }

  /**
   * Clean up old raw page views on the 1st of every month at 3:00 AM.
   */
  @Cron('0 3 1 * *')
  async cleanupOldRecords() {
    this.logger.log('Scheduling cleanup of old page view records...');
    await this.visitorQueue.add('cleanup-old', {}, {
      removeOnComplete: true,
      removeOnFail: 5,
    });
  }
}
