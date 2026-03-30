import { Module } from '@nestjs/common';
import { DonationService } from './donation.service';
import { DonationController } from './donation.controller';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [PrismaModule],
  controllers: [DonationController],
  providers: [DonationService],
  exports: [DonationService],
})
export class DonationModule {}
