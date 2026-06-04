import { IsIn } from 'class-validator';
import { ReviewStatus } from '@prisma/client';

/**
 * Moderate a review (PATCH /api/admin/store/reviews/:id).
 *
 * Only APPROVED / REJECTED are accepted — an admin cannot move a review back to
 * PENDING (the queue is forward-only). The service applies the rating-aggregate
 * delta ATOMICALLY (advisory lock + CAS) so re-approving is idempotent and a
 * APPROVED→REJECTED transition subtracts the rating that was previously added.
 */
export class ModerateReviewDto {
  // Extract<…> is the idiomatic type-level narrowing for a Prisma enum (generated
  // as a const object, NOT a TS `enum`, so `ReviewStatus.APPROVED` is a VALUE and
  // can't be used directly as a type annotation). This keeps the @IsIn value list
  // and the static type in lockstep without the non-standard `typeof` form.
  @IsIn([ReviewStatus.APPROVED, ReviewStatus.REJECTED])
  status!: Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>;
}
