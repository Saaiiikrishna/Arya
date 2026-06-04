import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid CUSTOMER JWT (role 'CUSTOMER', sub=Customer.id) verified by
 * the dedicated 'jwt-customer' Passport strategy. Use on registered-customer
 * store routes (account, addresses, own orders, convert-guest).
 *
 * Because it activates the 'jwt-customer' strategy — NOT the platform 'jwt'
 * strategy — an admin/applicant/investor token is rejected here even though it
 * shares the same JWT_SECRET signature.
 *
 * Missing/invalid token → 401 (Passport). Valid token, wrong role → 403. The
 * super.canActivate call is awaited as a Promise (AuthGuard returns
 * boolean | Promise<boolean>); we normalize a Passport rejection to a clean 401
 * so the failure path is never silently swallowed.
 */
@Injectable()
export class CustomerJwtGuard extends AuthGuard('jwt-customer') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    let authenticated: boolean;
    try {
      authenticated = (await super.canActivate(context)) as boolean;
    } catch {
      // Passport throws UnauthorizedException for a missing/invalid token.
      // Surface it as a 401 (not a 403) — absence of credentials, not a role.
      throw new UnauthorizedException('Customer authentication required');
    }
    if (!authenticated) {
      throw new UnauthorizedException('Customer authentication required');
    }

    const { user } = context.switchToHttp().getRequest();
    // Defense-in-depth: the strategy already pins role from the verified token,
    // but re-assert here so a wrong-role principal yields a deterministic 403.
    if (!user || user.role !== 'CUSTOMER') {
      throw new ForbiddenException('Customer access required');
    }
    return true;
  }
}
