import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { BatchProcessor } from './batch.processor';
import { SchedulerService } from './scheduler.service';
import { BatchModule } from '../batch';
import { TeamModule } from '../team';
import { EligibilityModule } from '../eligibility';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: 'batch-queue' },
      { name: 'email-queue' },
    ),
    PrismaModule,
    BatchModule,
    TeamModule,
    EligibilityModule,
  ],
  providers: [BatchProcessor, SchedulerService],
  exports: [BullModule],
})
export class JobsModule {}
