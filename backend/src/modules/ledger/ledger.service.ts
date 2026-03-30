import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLedgerDto } from './dto/create-ledger.dto';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransaction(createLedgerDto: CreateLedgerDto) {
    // We run this in a transaction to update the fundedAmount on the project
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.ledgerTransaction.create({
        data: createLedgerDto,
      });

      // If it's a disbursement, it increases the funded amount
      if (createLedgerDto.type === 'DISBURSEMENT') {
        await tx.project.update({
          where: { id: createLedgerDto.projectId },
          data: { fundedAmount: { increment: createLedgerDto.amount } },
        });
      }

      return transaction;
    });
  }

  async getTransactionsByProject(projectId: string) {
    return this.prisma.ledgerTransaction.findMany({
      where: { projectId },
      orderBy: { date: 'desc' },
    });
  }
}
