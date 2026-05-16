import { Module } from '@nestjs/common';
import { DocumentaryController } from './documentary.controller';
import { DocumentaryService } from './documentary.service';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentaryController],
  providers: [DocumentaryService],
  exports: [DocumentaryService],
})
export class DocumentaryModule {}
