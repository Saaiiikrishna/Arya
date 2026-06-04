import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { CouponContext } from '../coupons.service';

/**
 * Resolved coupon-validation context attached to the request by
 * OptionalCustomerGuard. Reads of `req.couponContext` are typed via this
 * augmentation so the controller stays free of JWT/config plumbing.
 */
declare module 'express-serve-static-core' {
  interface Request {
    couponContext?: CouponContext;
  }
}

/**
 * OPTIONAL authentication for the public `POST /store/coupons/validate` route.
 *
 * The route is public so guests can validate, but a registered CUSTOMER should
 * be recognised so the allowGuest gate + per-email pre-check apply. Rather than
 * decoding the bearer token by hand in the controller (a second verification
 * path outside Passport, with a manually-supplied secret — a code smell), this
 * guard reuses the already-registered `jwt-customer` Passport strategy (the
 * single source of truth for customer-token verification). It never blocks the
 * request: on a missing/invalid/non-customer token it resolves a guest context;
 * on a valid CUSTOMER token it resolves the registered-customer context. Either
 * way it attaches the result to `req.couponContext` and returns true.
 *
 * Identity comes ONLY from the verified token — never from the request body
 * (repo security rule 4ebf502). Because verification is delegated to the
 * strategy, a future migration to a dedicated customer secret is picked up
 * automatically; there is no second inline `verify(secret)` to drift.
 */
@Injectable()
export class OptionalCustomerGuard extends AuthGuard('jwt-customer') {
  /**
   * Passport calls handleRequest with the strategy outcome. We swallow any
   * error/absence (guest path) instead of throwing, and downgrade a non-CUSTOMER
   * principal to guest — so the guard is permissive by design.
   */
  handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser | false,
  ): TUser | null {
    return user || null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Run the strategy; handleRequest above guarantees it resolves (never throws)
    // even when the token is missing/invalid, so `req.user` is set or undefined.
    // Guard the call defensively anyway so a strategy-level error can never block
    // this public route.
    try {
      await super.canActivate(context);
    } catch {
      // Swallow — the route is public; absence of a valid token is a guest.
    }

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as
      | { id?: string; email?: string | null; role?: string }
      | undefined;

    if (user && user.role === 'CUSTOMER' && user.id) {
      req.couponContext = {
        isGuest: false,
        customerId: user.id,
        email: user.email ?? undefined,
      };
    } else {
      // No token / invalid token / non-customer principal → treat as a guest.
      // An admin/applicant who hits this public route with their platform token
      // is intentionally degraded to guest here: this route grants no privilege,
      // and only a verified store CUSTOMER unlocks registered-only coupons.
      req.couponContext = { isGuest: true };
    }

    // Always allow through — validation itself happens in the service.
    return true;
  }
}
