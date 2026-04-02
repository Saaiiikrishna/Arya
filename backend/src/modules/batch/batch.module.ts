import { Module } from '@nestjs/common';
import { BatchService } from './batch.service';
import { BatchController } from './batch.controller';
import { PrismaModule } from '../../prisma';
import { EmailModule } from '../email';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [BatchController],
  providers: [BatchService],
  exports: [BatchService],
})
export class BatchModule {}
