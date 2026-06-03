import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { AdminGuard, JwtAuthGuard } from '../auth/guards';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @UseGuards(AdminGuard)
  @Post()
  createTransaction(@Body() createLedgerDto: CreateLedgerDto) {
    return this.ledgerService.createTransaction(createLedgerDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('project/:projectId')
  getTransactions(@Param('projectId') projectId: string) {
    return this.ledgerService.getTransactionsByProject(projectId);
  }
}
