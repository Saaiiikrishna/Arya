import { Module } from '@nestjs/common';
import { EquityService } from './equity.service';
import { EquityController } from './equity.controller';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [PrismaModule],
  controllers: [EquityController],
  providers: [EquityService],
  exports: [EquityService],
})
export class EquityModule {}
