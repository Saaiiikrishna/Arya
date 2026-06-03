import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Single owner of the batch-queue backfill trigger. Exposed @Global (via
 * AutomationModule) so any service that removes an applicant from an already-
 * closed batch can top the gap back up from the next batch without each module
 * having to register the queue itself. Best-effort: a queue failure (e.g. Redis
 * down) is logged and swallowed so it never aborts the removal that triggered it.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(@InjectQueue('batch-queue') private readonly batchQueue: Queue) {}

  /**
   * Enqueue a backfill-cascade: pull `removedCount` oldest applicants from the
   * next batch into `batchId` to replace those who left a closed batch.
   */
  async enqueueBackfill(batchId: string | null | undefined, removedCount = 1): Promise<void> {
    if (!batchId || removedCount < 1) return;
    try {
      await this.batchQueue.add(
        'backfill-cascade',
        { batchId, removedCount },
        {
          removeOnComplete: true,
          removeOnFail: 20,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      this.logger.log(`Enqueued backfill-cascade for batch ${batchId} (need ${removedCount})`);
    } catch (e) {
      this.logger.error(`Failed to enqueue backfill for batch ${batchId}: ${(e as any)?.message}`);
    }
  }
}
