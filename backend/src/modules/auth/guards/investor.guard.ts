import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid JWT AND the INVESTOR role. Use on investor-facing routes so
 * applicants/admins can't act as investors and vice-versa.
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
