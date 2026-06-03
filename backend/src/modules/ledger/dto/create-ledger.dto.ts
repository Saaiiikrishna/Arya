import { LedgerTransactionType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
} from 'class-validator';

export class CreateLedgerDto {
  @IsUUID()
  projectId: string;

  // Integer minor units (paise). May be negative for debits, so no @Min.
  @IsInt()
  amount: number;

  @IsEnum(LedgerTransactionType)
  type: LedgerTransactionType;

  @IsString()
  description: string;

  @IsOptional()
  @IsDateString()
  date?: Date;
}
