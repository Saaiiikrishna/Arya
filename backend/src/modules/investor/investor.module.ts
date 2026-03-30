import { Module } from '@nestjs/common';
import { InvestorService } from './investor.service';
import { InvestorController } from './investor.controller';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [PrismaModule],
  controllers: [InvestorController],
  providers: [InvestorService],
  exports: [InvestorService],
})
export class InvestorModule {}
