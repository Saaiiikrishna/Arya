import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CouponService } from './coupons.service';

/**
 * `store-coupon-expiry` (Section 7): the daily cron that flips ACTIVE coupons
 * past their `expiresAt` to EXPIRED so the persisted status reflects reality.
 *
 * The architecture homes commerce crons in a dedicated `store-jobs` module; that
 * module is not built yet, so this single self-contained `@Cron` lives with the
 * coupon domain it owns. It relies on the app-wide `ScheduleModule.forRoot()`
 * (already registered in SettingsModule/JobsModule), so no module-level schedule
 * registration is needed here — `@Cron` providers are discovered globally. When
 * `store-jobs` is introduced this method can be moved/enqueued there unchanged
 * (the idempotent CASed `expireStaleCoupons` is the actual unit of work).
 *
 * Defensive: a failure is logged, never thrown, so a transient DB blip cannot
 * crash the scheduler (matches the platform AutomationScheduler convention).
 */
@Injectable()
export class CouponsScheduler {
  private readonly logger = new Logger(CouponsScheduler.name);

  constructor(private readonly coupons: CouponService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'store-coupon-expiry',
    timeZone: 'Asia/Kolkata',
  })
  async expireCoupons(): Promise<void> {
    try {
      const expired = await this.coupons.expireStaleCoupons();
      if (expired > 0) {
        this.logger.log(
          `store-coupon-expiry: flipped ${expired} coupon(s) ACTIVE→EXPIRED`,
        );
      }
    } catch (e) {
      this.logger.error(`store-coupon-expiry failed: ${(e as Error)?.message}`);
    }
  }
}
