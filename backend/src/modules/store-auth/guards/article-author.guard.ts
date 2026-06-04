import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Dual-issuer authorship guard for the articles vertical (Section 8.11).
 *
 * Accepts EITHER:
 *   - a platform APPLICANT JWT (Passport 'jwt' strategy → role 'APPLICANT'), or
 *   - a store CUSTOMER JWT  (Passport 'jwt-customer' strategy → role 'CUSTOMER').
 *
 * Passport runs BOTH strategies for the request; with a strategy array it does
 * not stop at the first success — the LAST strategy that does not error supplies
 * the principal (Passport multi-strategy "last-wins" semantics). In practice only
 * one of the two tokens is ever present on a given request, so exactly one
 * strategy resolves a user and the other resolves null; `handleRequest` (below)
 * returns the first truthy `user` it is handed, so whichever token authenticated
 * is the one that wins. The guard then PINS the authorship identity from the
 * verified token onto the request:
 *   - CUSTOMER  → req.authorType = 'CUSTOMER',  req.authorId = Customer.id
 *   - APPLICANT → req.authorType = 'APPLICANT', req.authorId = Applicant.id
 *
 * The client may NOT supply authorType/authorId, so a customer cannot forge an
 * applicant authorship with a discovered UUID, and vice-versa. Any other role
 * (admin/investor/mentor/cofounder) is rejected from authoring.
 */
@Injectable()
export class ArticleAuthorGuard extends AuthGuard(['jwt', 'jwt-customer']) {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new UnauthorizedException(
        'Authentication required to author articles',
      );
    }

    if (user.role === 'CUSTOMER') {
      req.authorType = 'CUSTOMER';
      req.authorId = user.id;
      return true;
    }

    if (user.role === 'APPLICANT') {
      // Pin the authorId to the canonical DB row id ONLY. Never fall back to the
      // raw JWT `sub` claim: a claim must not be usable directly as a DB foreign
      // key if validateUser()'s return shape ever changes. If `id` is absent the
      // identity is unresolved and authoring must be refused.
      const id = user.id;
      if (!id) {
        throw new UnauthorizedException('Could not resolve author identity');
      }
      req.authorType = 'APPLICANT';
      req.authorId = id;
      return true;
    }

    throw new UnauthorizedException(
      'Only customers or applicants may author articles',
    );
  }

  /**
   * With a strategy array, Passport's default behaviour surfaces the LAST
   * strategy's result, so a later strategy that resolves null could mask an
   * earlier success. Override so ANY truthy authenticated principal is accepted
   * (the token that authenticated wins) and a missing user yields a clean 401.
   * Because at most one of the two tokens is present per request, this reliably
   * returns the single resolved customer/applicant user.
   */
  handleRequest(err: any, user: any, _info: any, _context: any, _status?: any) {
    if (user) return user;
    if (err) throw err;
    throw new UnauthorizedException(
      'Authentication required to author articles',
    );
  }
}
