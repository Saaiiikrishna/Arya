import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BatchProcessor } from './batch.processor';
import { BatchModule } from '../batch';
import { TeamModule } from '../team';
import { EligibilityModule } from '../eligibility';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'batch-queue' },
      { name: 'email-queue' },
    ),
    BatchModule,
    TeamModule,
    EligibilityModule,
  ],
  providers: [BatchProcessor],
  exports: [BullModule],
})
export class JobsModule {}
