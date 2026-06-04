import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma';
import { AuthModule } from './modules/auth';
import { QuestionModule } from './modules/question';
import { ApplicantModule } from './modules/applicant';
import { BatchModule } from './modules/batch';
import { TeamModule } from './modules/team';
import { EmailModule } from './modules/email';
import { DocumentModule } from './modules/document';
import { EligibilityModule } from './modules/eligibility';
import { JobsModule } from './modules/jobs';
import { ProjectModule } from './modules/project/project.module';
import { SprintModule } from './modules/sprint/sprint.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PaymentModule } from './modules/payment/payment.module';
// Phase 2 modules
import { MatchingModule } from './modules/matching/matching.module';
import { InvestorModule } from './modules/investor/investor.module';
import { DonationModule } from './modules/donation/donation.module';
import { TrainingModule } from './modules/training/training.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ChatModule } from './modules/chat/chat.module';
import { SettingsModule } from './modules/settings/settings.module';

import { ElectionModule } from './modules/election/election.module';
import { AnnouncementModule } from './modules/announcement';
import { ReferralModule } from './modules/referral/referral.module';
import { EquityModule } from './modules/equity/equity.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { InterviewModule } from './modules/interview/interview.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { AutomationModule } from './modules/automation/automation.module';
import { MentorModule } from './modules/mentor';
import { CoFounderModule } from './modules/cofounder/cofounder.module';
import { DocumentaryModule } from './modules/documentary/documentary.module';
// Commerce / storefront (M2b foundational modules)
import { StoreAuthModule } from './modules/store-auth';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { TaxModule } from './modules/tax/tax.module';
import { StoreMediaModule } from './modules/store/store-media/store-media.module';
import { CouponsModule } from './modules/coupons';
import { CartModule } from './modules/cart';
import { DiyModule } from './modules/diy/diy.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { InvoicingModule } from './modules/invoicing';
import { OrdersModule } from './modules/orders';
import { ShippingModule } from './modules/shipping';
import { ReturnsModule } from './modules/returns';
import { StoreRealtimeModule } from './modules/store-realtime/store-realtime.module';
import { StoreJobsModule } from './modules/store-jobs/store-jobs.module';
import { StoreAnalyticsModule } from './modules/store-analytics/store-analytics.module';
import { ArticlesModule } from './modules/articles/articles.module';

/**
 * Fail-fast environment validation. Signing secrets must ALWAYS be strong
 * (a forgeable JWT is critical); webhook/payment/DB secrets are required in
 * production. In non-production we warn instead of throwing so local dev runs.
 */
function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const isProd = config.NODE_ENV === 'production';
  const problems: string[] = [];
  const requireStrong = (key: string, min = 32) => {
    const v = String(config[key] ?? '');
    if (!v || v.length < min || /change-?me|placeholder|secret-in-production/i.test(v)) {
      problems.push(`${key} must be a strong value (>= ${min} chars, no placeholder)`);
    }
  };
  const requirePresent = (key: string) => {
    if (!String(config[key] ?? '').trim()) problems.push(`${key} is required`);
  };

  requireStrong('JWT_SECRET');
  requireStrong('JWT_REFRESH_SECRET');
  if (isProd) {
    requirePresent('DATABASE_URL');
    requirePresent('RAZORPAY_KEY_SECRET');
    requirePresent('RAZORPAY_WEBHOOK_SECRET');
    // Store webhook secret is SEPARATE from the pledge webhook secret (the store
    // webhook handler in orders.service fails closed when absent). Enforce at boot
    // so a missing value never silently 500s every Razorpay store callback.
    requirePresent('RAZORPAY_STORE_WEBHOOK_SECRET');
    // Courier tracking webhook secret — the shipping webhook fails closed without
    // it, so enforce at boot rather than rejecting every courier callback at runtime.
    requirePresent('COURIER_WEBHOOK_SECRET');
    requirePresent('WHATSAPP_APP_SECRET');
  }

  if (problems.length) {
    const msg = 'Invalid environment configuration:\n  - ' + problems.join('\n  - ');
    if (isProd) throw new Error(msg);
    // eslint-disable-next-line no-console
    console.warn(`\x1b[33m[config] ${msg}\n  (permitted in non-production; set these before deploying)\x1b[0m`);
  }
  return config;
}

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

    // In-process domain events (decouples commerce services from the Socket.io
    // gateways: services emit 'stock.updated'/'order.updated'/... and the store
    // gateways broadcast). Note: cross-replica fan-out needs the Socket.io Redis
    // adapter (documented follow-up); listeners are wildcard-enabled.
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),

    // Rate limiting: multi-tier configuration
    ThrottlerModule.forRoot([{
      name: 'short', // 6 requests per min (useful for OTPs, strict APIs)
      ttl: 60000,
      limit: 6,
    }, {
      name: 'medium', // 100 requests per min (standard endpoints)
      ttl: 60000,
      limit: 100,
    }, {
      name: 'long', // 1000 requests per hour
      ttl: 3600000,
      limit: 1000,
    }]),

    // Redis / BullMQ
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const port = configService.get<number>('REDIS_PORT', 6379);
        const password = configService.get<string>('REDIS_PASSWORD');
        const useTls = String(port) === '6380';
        return {
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port,
            ...(password ? { password } : {}),
            ...(useTls ? { tls: {} } : {}),
            maxRetriesPerRequest: null,   // Required by BullMQ
            enableOfflineQueue: false,    // Don't queue commands when disconnected
            lazyConnect: true,            // Don't block startup
            retryStrategy(times: number) {
              if (times > 3) return null;  // Stop retrying after 3 attempts
              return Math.min(times * 500, 3000);
            },
          },
        };
      },
      inject: [ConfigService],
    }),

    // Core
    PrismaModule,

    // Feature modules
    AuthModule,
    QuestionModule,
    ApplicantModule,
    BatchModule,
    TeamModule,
    EmailModule,
    DocumentModule,
    EligibilityModule,
    JobsModule,
    ProjectModule,
    SprintModule,
    LedgerModule,
    PaymentModule,
    // Phase 2 modules
    MatchingModule,
    InvestorModule,
    DonationModule,
    TrainingModule,
    AnalyticsModule,
    ChatModule,
    SettingsModule,
    // Phase 3 module
    ElectionModule,
    AnnouncementModule,
    ReferralModule,
    EquityModule,
    WhatsappModule,
    RewardsModule,
    InterviewModule,
    NotificationModule,
    AutomationModule,
    MentorModule,
    CoFounderModule,
    DocumentaryModule,
    // Commerce / storefront (M2b foundational modules)
    StoreAuthModule,
    CatalogModule,
    InventoryModule,
    TaxModule,
    StoreMediaModule,
    CouponsModule,
    CartModule,
    DiyModule,
    PurchasingModule,
    InvoicingModule,
    OrdersModule,
    ShippingModule,
    ReturnsModule,
    StoreRealtimeModule,
    StoreJobsModule,
    StoreAnalyticsModule,
    ArticlesModule,
  ],
  providers: [
    // Apply rate limiting globally; per-route @Throttle still tunes the tiers.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
