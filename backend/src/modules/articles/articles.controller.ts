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
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ArticleAuthorType } from '@prisma/client';
import { ArticleAuthorGuard } from '../store-auth/guards';
import { VisitorService } from '../settings/visitor.service';
import { ArticlesService } from './articles.service';
import {
  CreateArticleDto,
  UpdateArticleDto,
  ArticleListQueryDto,
  MineArticleQueryDto,
  PresignArticleMediaDto,
  ConfirmArticleMediaDto,
} from './dto';

/**
 * Identity pinned onto the request by ArticleAuthorGuard from the verified JWT
 * (never the body). Read it through this shape so the author identity is always
 * server-sourced. (Architecture Section 8.11)
 */
interface AuthoredRequest extends Request {
  authorType?: ArticleAuthorType;
  authorId?: string;
}

/**
 * Articles vertical — PUBLIC reads + AUTHOR submit/edit/media.
 * (Architecture Section 10.) Admin moderation lives in ArticlesAdminController.
 *
 * @Controller('api') so the full path is spelled on each route, matching the
 * catalog/store convention.
 */
@Controller('api')
export class ArticlesController {
  constructor(
    private readonly articles: ArticlesService,
    // Best-effort page-view tracking on the public slug detail route (enqueued to
    // the existing visitor-queue). The service does NOT use it — mirroring the
    // catalog controller, the pageview is recorded at the controller so the
    // batched store-viewcount-increment job can later bump Article.viewCount from
    // DailyPageStat rows for '/articles/<slug>'. (Architecture Section 10 / 8.12)
    private readonly visitor: VisitorService,
  ) {}

  // ─── PUBLIC LIST (no guard) ───────────────────────────────
  // Rate-limited per IP so a crawler can't enumerate the whole catalog of
  // articles at the global standard tier.

  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @Get('articles')
  list(@Query() query: ArticleListQueryDto) {
    return this.articles.listPublic(query);
  }

  // ─── AUTHOR: own articles ─────────────────────────────────
  //
  // CRITICAL ordering: this static 'articles/mine' route is registered BEFORE
  // the parameterized 'articles/:slug' public reads below. Express (Nest's
  // adapter) matches routes in declaration order, so declaring 'mine' first
  // ensures GET /articles/mine resolves here and is not swallowed by ':slug'.

  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @UseGuards(ArticleAuthorGuard)
  @Get('articles/mine')
  listMine(@Req() req: AuthoredRequest, @Query() query: MineArticleQueryDto) {
    const { authorType, authorId } = this.author(req);
    return this.articles.listMine(authorType, authorId, query);
  }

  // ─── PUBLIC READ by slug (no guard) ───────────────────────

  // Stricter than the list read tier: the related query runs a GIN-overlap + tag
  // intersection cardinality computation per call and is not cached, so cap it on
  // the short tier to bound the per-IP DB load.
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Get('articles/:slug/related')
  getRelated(@Param('slug') slug: string) {
    return this.articles.getRelatedBySlug(slug);
  }

  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @Get('articles/:slug')
  async getBySlug(@Param('slug') slug: string, @Req() req: Request) {
    const article = await this.articles.getPublicBySlug(slug);
    // Record the pageview (enqueued; never blocks the response). The batched
    // Article.viewCount increment is owned by store-jobs viewCountSync, which
    // reads DailyPageStat rows for '/articles/<slug>' (Architecture Section 10).
    this.trackView(req, `/articles/${slug}`);
    return article;
  }

  // ─── AUTHOR (ArticleAuthorGuard — APPLICANT or CUSTOMER) ───

  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @UseGuards(ArticleAuthorGuard)
  @Post('articles')
  create(@Req() req: AuthoredRequest, @Body() dto: CreateArticleDto) {
    const { authorType, authorId } = this.author(req);
    return this.articles.create(authorType, authorId, dto);
  }

  // Re-edit/re-submit of a rejected article toggles REJECTED -> SUBMITTED back
  // into the moderation queue, so it is rate-matched to the submit (short) tier
  // to prevent an author flooding the queue with rapid resubmissions.
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @UseGuards(ArticleAuthorGuard)
  @Patch('articles/:id')
  update(
    @Req() req: AuthoredRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    const { authorType, authorId } = this.author(req);
    return this.articles.updateMine(id, authorType, authorId, dto);
  }

  // ─── AUTHOR: ARTICLE MEDIA (own article) ──────────────────

  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @UseGuards(ArticleAuthorGuard)
  @Post('articles/:id/media/presign')
  presignMedia(
    @Req() req: AuthoredRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PresignArticleMediaDto,
  ) {
    const { authorType, authorId } = this.author(req);
    return this.articles.presignMedia(id, authorType, authorId, dto);
  }

  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @UseGuards(ArticleAuthorGuard)
  @Post('articles/:id/media/:mediaId/confirm')
  confirmMedia(
    @Req() req: AuthoredRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('mediaId', new ParseUUIDPipe()) mediaId: string,
    @Body() dto: ConfirmArticleMediaDto,
  ) {
    const { authorType, authorId } = this.author(req);
    return this.articles.confirmMedia(id, mediaId, authorType, authorId, dto);
  }

  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @UseGuards(ArticleAuthorGuard)
  @Delete('articles/:id/media/:mediaId')
  deleteMedia(
    @Req() req: AuthoredRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('mediaId', new ParseUUIDPipe()) mediaId: string,
  ) {
    const { authorType, authorId } = this.author(req);
    return this.articles.deleteMedia(id, mediaId, authorType, authorId);
  }

  // ─── INTERNAL ─────────────────────────────────────────────

  /**
   * Extract the server-pinned author identity that ArticleAuthorGuard placed on
   * the request. Defends in depth: if the guard somehow ran without populating
   * the identity, fail closed rather than proceed with an unknown author.
   */
  private author(req: AuthoredRequest): {
    authorType: ArticleAuthorType;
    authorId: string;
  } {
    const { authorType, authorId } = req;
    if (!authorType || !authorId) {
      throw new BadRequestException('Author identity could not be resolved');
    }
    return { authorType, authorId };
  }

  /**
   * Fire-and-forget page-view tracking; swallows all errors so tracking never
   * affects the response. IP is taken solely from `req.ip` / the socket remote
   * address — the raw `X-Forwarded-For` header is intentionally NOT read (Express
   * is not configured with `trust proxy`, so an unauthenticated client could
   * otherwise spoof any source IP into the visitor analytics). Mirrors the
   * catalog controller's trackView.
   */
  private trackView(req: Request, path: string): void {
    try {
      const headers: import('http').IncomingHttpHeaders = req.headers;
      const headerStr = (name: string): string | undefined => {
        const v: string | string[] | undefined = headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      const sessionId: string = headerStr('x-session-id') ?? 'anonymous';
      void this.visitor
        .trackPageView({
          sessionId,
          path,
          referrer: headerStr('referer') ?? headerStr('referrer'),
          ip: req.ip ?? req.socket?.remoteAddress,
          userAgent: headerStr('user-agent'),
        })
        .catch(() => undefined);
    } catch {
      /* tracking must never affect the response */
    }
  }
}
