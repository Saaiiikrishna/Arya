import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Predefined rejection reason codes. A constrained primary field (vs. raw free
 * text) keeps the audit trail structured and removes the stored-XSS / PDF-
 * injection surface that an unbounded free-text reason would carry when the value
 * is later rendered in the admin UI or a generated document.
 */
export enum RejectReasonCode {
  RETURN_WINDOW_EXPIRED = 'RETURN_WINDOW_EXPIRED',
  ITEM_NOT_RETURNED = 'ITEM_NOT_RETURNED',
  POLICY_VIOLATION = 'POLICY_VIOLATION',
  OTHER = 'OTHER',
}

/**
 * Body for `PATCH /api/admin/store/returns/:id/reject`. A structured `reason`
 * code is required (auditable + surfaceable to the customer); an optional
 * free-text `note` carries any nuance. The controller composes the two into the
 * persisted rejection comment.
 */
export class RejectReturnDto {
  @IsEnum(RejectReasonCode)
  reason!: RejectReasonCode;

  /** Optional free-text detail. Bounded; treat as untrusted when rendering. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
