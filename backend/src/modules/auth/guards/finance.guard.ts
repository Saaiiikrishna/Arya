import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

const FINANCE_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Requires a valid JWT AND a finance-capable role (ADMIN or SUPER_ADMIN only).
 *
 * Stricter than AdminGuard: a MODERATOR passes AdminGuard (it is in ADMIN_ROLES)
 * and may triage queues, but MUST NOT be able to move money or stock. Use this
 * guard on routes that issue refunds, restock inventory, transition order state,
 * generate invoices/shipments, or otherwise have irreversible financial/inventory
 * side effects. MODERATOR is rejected with a ForbiddenException (fail-closed).
 */
@Injectable()
export class FinanceGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const { user } = context.switchToHttp().getRequest();
    if (!user || !FINANCE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Finance access required');
    }
    return true;
  }
}
