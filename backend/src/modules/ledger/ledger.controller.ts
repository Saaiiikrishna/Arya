import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common';
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
  getTransactions(@Req() req: any, @Param('projectId') projectId: string) {
    const requesterId = req.user.id || req.user.sub;
    return this.ledgerService.getTransactionsByProject(
      projectId,
      requesterId,
      req.user.role,
    );
  }
}
