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
  ],
})
export class AppModule {}
