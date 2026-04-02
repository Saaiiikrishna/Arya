import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma';
import { SettingsService } from './settings.service';
import { VisitorService } from './visitor.service';
import { VisitorProcessor } from './visitor.processor';
import { SettingsController } from './settings.controller';
import { TrackingController } from './tracking.controller';
import { VisitorScheduler } from './visitor.scheduler';
import { DangerZoneController } from './danger-zone.controller';
import { DangerZoneService } from './danger-zone.service';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'visitor-queue' }),
    ScheduleModule.forRoot(),
  ],
  controllers: [SettingsController, TrackingController, DangerZoneController],
  providers: [
    SettingsService,
    VisitorService,
    VisitorProcessor,
    VisitorScheduler,
    DangerZoneService,
  ],
  exports: [SettingsService, VisitorService],
})
export class SettingsModule {}
