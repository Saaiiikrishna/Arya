import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminGuard } from '../auth/guards';
import { ArticlesService } from './articles.service';
import {
  AdminArticleQueryDto,
  AdminUpdateArticleDto,
  RejectArticleDto,
} from './dto';

/** req.user shape set by AdminGuard (the verified admin row + role). */
interface AdminRequest extends Request {
  user?: { id?: string; role?: string };
}

/**
 * Articles vertical — ADMIN moderation surface (architecture Section 10).
 * Every route is admin-only, so AdminGuard is applied once at the CONTROLLER
 * level (repo controller-level-guard rule) rather than duplicated per method.
 * `decidedByAdminId` is ALWAYS sourced from the verified JWT (req.user.id), never
 * the request body (repo security rule 4ebf502).
 *
 * Author-vs-admin visibility invariant: these endpoints (and ONLY these) expose
 * the richer view metrics (unique IPs, geo, referrers). Authors see only their
 * own viewCount via the author surface.
 */
@UseGuards(AdminGuard)
@Controller('api')
export class ArticlesAdminController {
  constructor(private readonly articles: ArticlesService) {}

  // Read-only moderation surfaces — explicit medium tier (kept off the global
  // default so the per-route intent is documented and consistent with the
  // author/public controller, which annotates every route).
  @Throttle({ medium: { limit: 60, ttl: 60000 } })
  @Get('admin/store/articles')
  list(@Query() query: AdminArticleQueryDto) {
    return this.articles.adminList(query);
  }

  @Throttle({ medium: { limit: 60, ttl: 60000 } })
  @Get('admin/store/articles/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.articles.adminGet(id);
  }

  // Mutating moderation actions — strict short tier so a brute-forced admin
  // token cannot mass-approve / mass-delete the catalog at the global rate.
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('admin/store/articles/:id/approve')
  approve(
    @Req() req: AdminRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.articles.approve(id, this.adminId(req));
  }

  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('admin/store/articles/:id/reject')
  reject(
    @Req() req: AdminRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectArticleDto,
  ) {
    return this.articles.reject(id, this.adminId(req), dto.reason);
  }

  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Patch('admin/store/articles/:id')
  update(
    @Req() req: AdminRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminUpdateArticleDto,
  ) {
    return this.articles.adminUpdate(id, this.adminId(req), dto);
  }

  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('admin/store/articles/:id/restore')
  restore(
    @Req() req: AdminRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.articles.restore(id, this.adminId(req));
  }

  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Delete('admin/store/articles/:id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.articles.remove(id);
  }

  // ─── INTERNAL ─────────────────────────────────────────────

  /** Pin the deciding admin id to the verified JWT; fail closed if absent. */
  private adminId(req: AdminRequest): string {
    const id = req.user?.id;
    if (!id) {
      throw new UnauthorizedException('Admin identity could not be resolved');
    }
    return id;
  }
}
