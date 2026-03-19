import { WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma';
import { BatchService } from '../batch';
import { TeamService } from '../team';
import { EligibilityService } from '../eligibility';
import { EmailService } from '../email';
import { ConfigService } from '@nestjs/config';
export declare class BatchProcessor extends WorkerHost {
    private readonly prisma;
    private readonly batchService;
    private readonly teamService;
    private readonly eligibilityService;
    private readonly emailService;
    private readonly configService;
    private readonly logger;
    constructor(prisma: PrismaService, batchService: BatchService, teamService: TeamService, eligibilityService: EligibilityService, emailService: EmailService, configService: ConfigService);
    process(job: Job): Promise<any>;
    private handleCheckBatchCapacity;
    private handleScreenBatch;
    private handleFormTeams;
    private handleBackfillCascade;
    private handleSendBatchNotifications;
}
