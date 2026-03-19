import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
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

    // Redis / BullMQ
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
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
