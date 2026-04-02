import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
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

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 30,
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
  ],
})
export class AppModule {}
