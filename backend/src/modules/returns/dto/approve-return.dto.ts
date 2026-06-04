import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /api/admin/store/returns/:id/approve`. The approval is the
 * money path (refund + restock + credit note); it takes no financial input —
 * the refund amount is the server-computed `Return.refundAmount` frozen at
 * request time. Only an optional admin note is accepted.
 */
export class ApproveReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
