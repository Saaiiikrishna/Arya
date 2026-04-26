import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RewardsModule } from '../rewards/rewards.module';
import { ApplicantService } from './applicant.service';
import { ApplicantController } from './applicant.controller';

@Module({
  imports: [PrismaModule, WhatsappModule, RewardsModule],
  controllers: [ApplicantController],
  providers: [ApplicantService],
  exports: [ApplicantService],
})
export class ApplicantModule {}
