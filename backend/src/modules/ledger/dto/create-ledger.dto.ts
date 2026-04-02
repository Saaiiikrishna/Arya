import { LedgerTransactionType } from '@prisma/client';

export class CreateLedgerDto {
  projectId: string;
  amount: number;
  type: LedgerTransactionType;
  description: string;
  date?: Date;
}
