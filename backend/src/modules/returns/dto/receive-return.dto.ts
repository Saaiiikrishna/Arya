import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /api/admin/store/returns/:id/receive`. Receiving is the money
 * path (restock + refund + credit note); it takes no financial input — the refund
 * amount is the server-computed `Return.refundAmount` frozen at request time. Only
 * an optional admin note (e.g. condition-on-arrival) is accepted.
 */
export class ReceiveReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
