import { Module } from '@nestjs/common';
import { ElectionController } from './election.controller';
import { ElectionService } from './election.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [ElectionController],
  providers: [ElectionService],
  exports: [ElectionService],
})
export class ElectionModule {}
