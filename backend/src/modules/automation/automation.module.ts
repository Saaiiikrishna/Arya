import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma';
import { EquityModule } from '../equity/equity.module';
import { AutomationScheduler } from './automation.scheduler';
import { BackfillService } from './backfill.service';

/**
 * Hosts time-driven jobs (equity handover, deadline reminders) and the @Global
 * BackfillService. NotificationService is @Global so no import is needed;
 * ScheduleModule.forRoot() lives in SettingsModule. Marked @Global so any
 * service can inject BackfillService without re-registering the batch-queue.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    EquityModule,
    BullModule.registerQueue({ name: 'batch-queue' }),
  ],
  providers: [AutomationScheduler, BackfillService],
  exports: [BackfillService],
})
export class AutomationModule {}
