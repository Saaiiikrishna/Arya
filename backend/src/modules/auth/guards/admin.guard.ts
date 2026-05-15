import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];
const SUPER_ADMIN_ROLES = ['SUPER_ADMIN'];

/**
 * Requires a valid JWT AND an admin-level role (ADMIN, SUPER_ADMIN, MODERATOR).
 * Use this on all /admin/* routes to prevent authenticated applicants from
 * accessing admin functionality.
 */
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const { user } = context.switchToHttp().getRequest();
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}

/**
 * Requires a valid JWT AND the SUPER_ADMIN role.
 * Use this on destructive operations (danger zone, etc.).
 */
@Injectable()
export class SuperAdminGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const { user } = context.switchToHttp().getRequest();
    if (!user || !SUPER_ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
