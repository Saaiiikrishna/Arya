import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StoreMediaController } from './store-media.controller';
import { StoreMediaService } from './store-media.service';

/**
 * Store media module: presign/confirm/delete for product media with
 * row-reservation cap enforcement, plus a gc helper for the store-media-gc cron.
 *
 * PrismaModule is @Global() so it is not imported here. ConfigModule is imported
 * for AWS bucket/region resolution (it is also global in app.module, imported
 * here defensively). StoreMediaService is exported so the articles module (M4)
 * and the jobs SchedulerService (which drives the store-media-gc cron) can reuse
 * the generic media primitives.
 */
@Module({
  imports: [ConfigModule],
  controllers: [StoreMediaController],
  providers: [StoreMediaService],
  exports: [StoreMediaService],
})
export class StoreMediaModule {}
