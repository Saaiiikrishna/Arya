import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid JWT AND the INVESTOR role.
 * Apply to all /investors/* routes that should be inaccessible to applicants and admins.
 */
@Injectable()
export class InvestorGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.role !== 'INVESTOR') {
      throw new ForbiddenException('Investor access required');
    }
    return true;
  }
}
