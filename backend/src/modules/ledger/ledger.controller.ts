import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { CreateLedgerDto } from './dto/create-ledger.dto';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Post()
  createTransaction(@Body() createLedgerDto: CreateLedgerDto) {
    return this.ledgerService.createTransaction(createLedgerDto);
  }

  @Get('project/:projectId')
  getTransactions(@Param('projectId') projectId: string) {
    return this.ledgerService.getTransactionsByProject(projectId);
  }
}
