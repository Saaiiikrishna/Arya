import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import {
  Prisma,
  ArticleStatus,
  ArticleMediaType,
  ArticleMediaStatus,
  ArticleAuthorType,
} from '@prisma/client';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';
import {
  CreateArticleDto,
  UpdateArticleDto,
  ArticleListQueryDto,
  MineArticleQueryDto,
  AdminArticleQueryDto,
  AdminUpdateArticleDto,
  PresignArticleMediaDto,
  ConfirmArticleMediaDto,
  ALLOWED_ARTICLE_MEDIA_MIME,
  ARTICLE_MEDIA_CAP,
  ARTICLE_MEDIA_MAX_BYTES,
} from './dto';

/** Max slug-collision retries before surfacing a 409 SLUG_CONFLICT. */
const SLUG_MAX_ATTEMPTS = 10;

/** Presigned PUT URL lifetime (seconds). Orphan PENDING rows are GC'd after this. */
const MEDIA_PRESIGN_TTL_SECONDS = 3600;

/** Default + max page size for paginated reads. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Max related articles returned by the related endpoint. */
const RELATED_LIMIT = 5;

/**
 * Reserved tag that expresses the curated "featured" flag for an article. The
 * schema has no `isFeatured` column on Article, so featuring is modeled as this
 * sentinel tag (kept out of the user-facing tag list in responses). The public
 * list sorts featured-first by checking for this tag.
 */
const FEATURED_TAG = '__featured__';

/**
 * Author-safe projection for an article. Deliberately EXCLUDES admin-only
 * metrics: it exposes `viewCount` (the author may see their own view count) but
 * NEVER per-visitor / geo / referrer breakdowns, `reviewedById`, or anything
 * else admin-only. This is the key visibility invariant.
 */
const AUTHOR_SAFE_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverS3Key: true,
  status: true,
  tags: true,
  viewCount: true,
  rejectionReason: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ArticleSelect;

@Injectable()
export class ArticlesService implements OnModuleInit {
  private readonly logger = new Logger(ArticlesService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly isProd: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
    this.bucket = this.config.get<string>('AWS_S3_BUCKET', 'arya-documents');
    this.isProd = this.config.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Fail-fast in production if AWS credentials are absent. With empty-string
   * credentials the SDK silently falls through to the instance-metadata chain;
   * on a non-AWS host that yields an obscure timeout on the first S3 call
   * instead of a clear startup error. Mirrors StoreMediaService's guard.
   */
  onModuleInit(): void {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID', '');
    const secretAccessKey = this.config.get<string>(
      'AWS_SECRET_ACCESS_KEY',
      '',
    );
    if (this.isProd && (!accessKeyId || !secretAccessKey)) {
      throw new Error(
        'ArticlesService: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required in production',
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SLUG GENERATION (race-safe)
  // ──────────────────────────────────────────────────────────────────────────

  /** Derive a URL-safe base slug from an arbitrary title. */
  private static baseSlug(title: string): string {
    const slug = title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/gu, '') // strip combining diacritical marks
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return slug || 'article';
  }

  /** True if a P2002 unique violation targets the `slug` column. */
  private static targetsSlug(e: Prisma.PrismaClientKnownRequestError): boolean {
    const target = e.meta?.target;
    if (Array.isArray(target))
      return target.some((t) => String(t).includes('slug'));
    if (typeof target === 'string') return target.includes('slug');
    // Some adapters omit meta.target; assume slug — it is the only unique we
    // retry on these creates.
    return true;
  }

  /**
   * Race-safe insert that derives a slug from `title` and retries with `-2`,
   * `-3`, … on a unique-constraint collision (Prisma P2002 on `slug`). Two
   * concurrent creates of the same title both derive the same base slug; the DB
   * `@unique` guarantees only one wins per candidate, so the loser retries the
   * next suffix instead of crashing with a 500. Exhausting the bounded attempts
   * surfaces a friendly 409 SLUG_CONFLICT. (Architecture Section 8.14)
   */
  private async insertWithUniqueSlug<T>(
    title: string,
    create: (slug: string) => Promise<T>,
  ): Promise<T> {
    const base = ArticlesService.baseSlug(title);
    for (let attempt = 1; attempt <= SLUG_MAX_ATTEMPTS; attempt++) {
      // attempt is the retry counter (1-based). The first attempt uses the bare
      // base; each collision appends the attempt number as the suffix, so the
      // candidate sequence is `base`, `base-2`, `base-3`, … (the `-1` suffix is
      // intentionally skipped — `base` already plays that role).
      const suffix = attempt;
      const candidate = attempt === 1 ? base : `${base}-${suffix}`;
      try {
        return await create(candidate);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          ArticlesService.targetsSlug(e)
        ) {
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException({
      code: 'SLUG_CONFLICT',
      message: `Could not generate a unique slug for "${title}" after ${SLUG_MAX_ATTEMPTS} attempts`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC READ
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Public paginated list of PUBLISHED articles. Filters: tag (array overlap),
   * category (treated as a tag — articles carry tags, not a category column),
   * and a bounded ILIKE search over title/excerpt.
   *
   * Ordered PURELY by recency (publishedAt desc, createdAt desc) so pagination is
   * correct and consistent across pages. Featured-first is NOT applied here: with
   * a column-less featured flag (it is the reserved FEATURED_TAG, not an orderBy-
   * able column) the only way to honor it would be an in-memory re-sort of the
   * already-paginated page slice — which silently reorders just the current page
   * and breaks featured-first across pages (a featured article on page 3 never
   * gets promoted). The page-1 "featured strip" is derived by the frontend from
   * the returned `isFeatured` flag, so the list makes no false cross-page promise.
   */
  async listPublic(query: ArticleListQueryDto) {
    const { page, limit, skip } = this.resolvePaging(query.page, query.limit);

    const where: Prisma.ArticleWhereInput = {
      status: ArticleStatus.PUBLISHED,
    };

    const tagFilters: string[] = [];
    if (query.tag) tagFilters.push(query.tag);
    // `category` has no dedicated column on Article; honor it as a tag match so
    // the public category filter still works against the existing schema.
    if (query.category) tagFilters.push(query.category);
    if (tagFilters.length > 0) {
      // hasEvery → all requested tags must be present (tag AND category).
      where.tags = { hasEvery: tagFilters };
    }

    if (query.search) {
      const term = query.search.trim();
      if (term) {
        where.OR = [
          { title: { contains: term, mode: 'insensitive' } },
          { excerpt: { contains: term, mode: 'insensitive' } },
        ];
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        // Pure recency order so pagination is correct and stable across pages.
        // (Featured cannot be a column orderBy — it is the reserved FEATURED_TAG,
        // not a column — and an in-memory re-sort would only reorder this page,
        // breaking featured-first across pages. The frontend derives its page-1
        // featured strip from the returned `isFeatured` flag instead.)
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          coverS3Key: true,
          tags: true,
          authorName: true,
          publishedAt: true,
        },
      }),
      this.prisma.article.count({ where }),
    ]);

    const data = rows.map((r) => ArticlesService.toPublicListItem(r));

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Public single PUBLISHED article by slug (404 otherwise). Returns body,
   * CONFIRMED media only, author display name, and publishedAt.
   *
   * `viewCount` is intentionally NOT returned on the public detail/list surfaces
   * (it is an analytics signal authors/admins see on their own surfaces, not a
   * public popularity metric to scrape — review HIGH). The status filter is
   * pushed into the WHERE clause so a non-published slug takes the SAME query
   * path as an absent one (closes the find-then-check timing side-channel — the
   * media join no longer runs for unpublished slugs; review MEDIUM).
   *
   * Does NOT increment views here — the controller records the pageview via
   * VisitorService and Article.viewCount is synced from DailyPageStat by the
   * store-jobs viewCountSync (architecture Section 10 / 8.12).
   *
   * NOTE: `body` is untrusted author-/admin-supplied rich-text JSON returned
   * verbatim; the storefront MUST render it through a sandboxed rich-text
   * renderer (never dangerouslySetInnerHTML) to avoid stored XSS.
   */
  async getPublicBySlug(slug: string) {
    const article = await this.prisma.article.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED },
      include: {
        media: {
          where: { status: ArticleMediaStatus.CONFIRMED },
          orderBy: [
            { type: 'asc' },
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
          ],
        },
      },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    return {
      id: article.id,
      slug: article.slug,
      title: article.title,
      body: article.body,
      excerpt: article.excerpt,
      coverS3Key: article.coverS3Key,
      authorName: article.authorName,
      tags: ArticlesService.visibleTags(article.tags),
      isFeatured: article.tags.includes(FEATURED_TAG),
      publishedAt: article.publishedAt,
      media: article.media.map((m) => ({
        id: m.id,
        type: m.type,
        s3Key: m.s3Key,
        caption: m.caption,
        sortOrder: m.sortOrder,
      })),
    };
  }

  /**
   * Up to 5 related PUBLISHED articles for a published article, by shared tags
   * (array overlap on the GIN-indexed `tags`) then same-tag fallback, excluding
   * self. Ordered by tag-overlap count desc then recency.
   *
   * The overlap (&&) + ordinality count is done in raw SQL so the GIN index is
   * used and the relevance ranking happens in Postgres, not Node.
   */
  async getRelatedBySlug(slug: string) {
    // Status pushed into the WHERE so a non-published slug takes the same path as
    // an absent one (no find-then-check timing side-channel).
    const article = await this.prisma.article.findFirst({
      where: { slug, status: ArticleStatus.PUBLISHED },
      select: { id: true, tags: true },
    });
    if (!article) {
      throw new NotFoundException('Article not found');
    }

    const visibleTags = ArticlesService.visibleTags(article.tags);
    if (visibleTags.length === 0) {
      // No tags to relate on — nothing to return (category fallback would need a
      // category column the schema does not have).
      return [];
    }

    // Build an explicit `ARRAY['t1','t2',...]::text[]` literal from individually
    // bound parameters (each tag is a separate placeholder via Prisma.join) —
    // the repo's proven pattern for array params. This avoids relying on the pg
    // adapter coercing a single JS-array bind into a Postgres text[], and is
    // injection-safe. The overlap operator (&&) uses the articles_tags_gin index
    // and the relevance ranking (shared-tag count) is computed in Postgres.
    const tagsArraySql = Prisma.sql`ARRAY[${Prisma.join(visibleTags)}]::text[]`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        slug: string;
        title: string;
        excerpt: string | null;
        cover_s3_key: string | null;
        tags: string[];
        author_name: string | null;
        published_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT a.id, a.slug, a.title, a.excerpt, a.cover_s3_key, a.tags,
             a.author_name, a.published_at
      FROM articles a
      WHERE a.status = 'PUBLISHED'
        AND a.id <> ${article.id}::uuid
        AND a.tags && ${tagsArraySql}
      ORDER BY cardinality(
                 ARRAY(SELECT unnest(a.tags) INTERSECT SELECT unnest(${tagsArraySql}))
               ) DESC,
               a.published_at DESC NULLS LAST,
               a.created_at DESC
      LIMIT ${RELATED_LIMIT}
    `);

    return rows.map((r) =>
      ArticlesService.toPublicListItem({
        id: r.id,
        slug: r.slug,
        title: r.title,
        excerpt: r.excerpt,
        coverS3Key: r.cover_s3_key,
        tags: r.tags,
        authorName: r.author_name,
        publishedAt: r.published_at,
      }),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUTHOR
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Submit a new article -> SUBMITTED (the moderation-queue/"pending review"
   * state; the schema enum has no PENDING_REVIEW, SUBMITTED is its equivalent).
   * authorType/authorId are pinned from the verified token by ArticleAuthorGuard
   * and passed in by the controller — NEVER read from the request body. The slug
   * is generated race-safely from the title.
   */
  async create(
    authorType: ArticleAuthorType,
    authorId: string,
    dto: CreateArticleDto,
  ) {
    const authorName = await this.resolveAuthorName(authorType, authorId);
    const tags = this.normalizeTags(dto.tags);

    // A cover is NOT accepted at create time. The article id does not exist yet,
    // so only the generic `articles/{uuid}/` prefix is checkable here — NOT that
    // the key belongs to a CONFIRMED media row on THIS article. Accepting it now
    // would let a caller pin a cover to another article's (or a not-yet-owned)
    // key (cross-article key injection). A cover is therefore set later via the
    // PATCH update path, which validates the key against this article's own
    // prefix + a CONFIRMED ArticleMedia IMAGE row it owns. Reject rather than
    // silently drop so the client learns the correct flow.
    if (dto.coverS3Key !== undefined) {
      throw new BadRequestException({
        code: 'COVER_NOT_ALLOWED_ON_CREATE',
        message:
          'coverS3Key cannot be set at create time; upload the image via the article media flow, then set the cover via PATCH /api/articles/:id',
      });
    }

    return this.insertWithUniqueSlug(dto.title, (slug) =>
      this.prisma.article.create({
        data: {
          slug,
          title: dto.title,
          body: dto.body as Prisma.InputJsonValue,
          excerpt: dto.excerpt,
          authorType,
          authorId,
          authorName,
          status: ArticleStatus.SUBMITTED,
          tags,
        },
        select: AUTHOR_SAFE_SELECT,
      }),
    );
  }

  /**
   * The caller's own articles (any status), author-safe fields only. Never
   * leaks admin-only metrics (only `viewCount` is exposed per article).
   */
  async listMine(
    authorType: ArticleAuthorType,
    authorId: string,
    query: MineArticleQueryDto,
  ) {
    const { page, limit, skip } = this.resolvePaging(query.page, query.limit);

    const where: Prisma.ArticleWhereInput = { authorType, authorId };
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: AUTHOR_SAFE_SELECT,
      }),
      this.prisma.article.count({ where }),
    ]);

    const data = rows.map((r) => ({
      ...r,
      tags: ArticlesService.visibleTags(r.tags),
      isFeatured: r.tags.includes(FEATURED_TAG),
    }));

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Edit the caller's OWN article, permitted only while DRAFT or REJECTED.
   * (The schema has no DRAFT state; SUBMITTED is in the moderation queue and is
   * intentionally NOT editable. So in practice editing is allowed while
   * REJECTED.) Ownership is enforced (authorType + authorId must match) — a
   * mismatch yields 404 (do not reveal existence) and a wrong-state edit yields
   * 409. A successful edit of a REJECTED article re-submits it
   * (REJECTED -> SUBMITTED) unless `resubmit:false` is passed.
   */
  async updateMine(
    id: string,
    authorType: ArticleAuthorType,
    authorId: string,
    dto: UpdateArticleDto,
  ) {
    const existing = await this.prisma.article.findUnique({
      where: { id },
      select: {
        id: true,
        authorType: true,
        authorId: true,
        status: true,
        tags: true,
      },
    });
    // Not found OR not owned → 404 (never disclose another author's article).
    if (
      !existing ||
      existing.authorType !== authorType ||
      existing.authorId !== authorId
    ) {
      throw new NotFoundException('Article not found');
    }

    // Editable states only. SUBMITTED (in-queue) and PUBLISHED are locked to the
    // author; an in-queue article must be moderated, a published one is admin's.
    const editable: ArticleStatus[] = [ArticleStatus.REJECTED];
    if (!editable.includes(existing.status)) {
      throw new ConflictException({
        code: 'ARTICLE_NOT_EDITABLE',
        message:
          'Only a rejected article can be edited and re-submitted by its author',
      });
    }

    // A cover must reference a CONFIRMED image this article actually owns (blocks
    // cross-article cover hijacking / foreign-prefix / path-traversal keys).
    if (dto.coverS3Key !== undefined) {
      await this.validateCoverS3Key(dto.coverS3Key, id);
    }

    const data: Prisma.ArticleUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body as Prisma.InputJsonValue;
    if (dto.excerpt !== undefined) data.excerpt = dto.excerpt;
    if (dto.coverS3Key !== undefined) data.coverS3Key = dto.coverS3Key;
    if (dto.tags !== undefined) {
      // Preserve the reserved featured tag (author cannot set/clear it).
      data.tags = this.mergeReservedTags(
        existing.tags,
        this.normalizeTags(dto.tags),
      );
    }

    // Re-submit a fixed-up rejected article back into the queue (default true).
    const resubmit = dto.resubmit !== false;
    if (resubmit) {
      data.status = ArticleStatus.SUBMITTED;
      data.rejectionReason = null;
    }

    return this.prisma.article.update({
      where: { id },
      data,
      select: AUTHOR_SAFE_SELECT,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ARTICLE MEDIA (author, own article) — row-reservation cap, S3 presign/confirm
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reserve a media cap slot and issue a presigned PUT URL for an author's OWN
   * article. ROW-RESERVATION cap: inside an advisory-locked transaction we count
   * existing rows of that type where status IN (PENDING, CONFIRMED), abort with
   * 409 MEDIA_CAP_REACHED if the cap (15 IMAGE / 3 VIDEO) is reached, then INSERT
   * a PENDING row before issuing the URL — so concurrent presigns can't all read
   * count=0 and oversubscribe. Orphan PENDING rows are swept by the media-gc
   * cron after the presign TTL. Mirrors store-media exactly.
   */
  async presignMedia(
    articleId: string,
    authorType: ArticleAuthorType,
    authorId: string,
    dto: PresignArticleMediaDto,
  ) {
    // Ownership + editability gate (media may only be managed on an author's own
    // not-yet-published article).
    await this.assertOwnEditableArticle(articleId, authorType, authorId);

    const { safeFileName, normalizedMimeType } = this.validateMediaUploadInput(
      dto.type,
      dto.fileName,
      dto.mimeType,
    );
    const cap = ARTICLE_MEDIA_CAP[dto.type];

    const media = await this.prisma.$transaction(async (tx) => {
      // Serialize cap checks for this (article,type) bucket so concurrent
      // presigns cannot both read a stale count (payment/equity advisory idiom).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`article_media_${articleId}_${dto.type}`}))`;

      const used = await tx.articleMedia.count({
        where: {
          articleId,
          type: dto.type,
          status: {
            in: [ArticleMediaStatus.PENDING, ArticleMediaStatus.CONFIRMED],
          },
        },
      });
      if (used >= cap) {
        throw new ConflictException({
          code: 'MEDIA_CAP_REACHED',
          message: `Media cap reached for ${dto.type} (max ${cap}); confirm or delete an existing item first`,
        });
      }

      const s3Key = `articles/${articleId}/${dto.type.toLowerCase()}/${uuidv4()}-${safeFileName}`;
      return tx.articleMedia.create({
        data: {
          articleId,
          type: dto.type,
          status: ArticleMediaStatus.PENDING,
          s3Key,
          caption: dto.caption,
          sortOrder: used, // append after existing slots
        },
      });
    });

    // Sign the URL only after the slot is durably reserved.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: media.s3Key,
      ContentType: normalizedMimeType,
      // ContentType is signed (client must PUT a matching Content-Type); size is
      // enforced authoritatively at confirm via HeadObject.
    });

    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(this.s3, command, {
        expiresIn: MEDIA_PRESIGN_TTL_SECONDS,
      });
    } catch (e) {
      // Release the reservation so the cap slot is not permanently leaked.
      await this.prisma.articleMedia
        .delete({ where: { id: media.id } })
        .catch(() => undefined);
      this.logger.error(
        `Failed to sign article upload URL for ${articleId}: ${(e as Error)?.message}`,
      );
      throw new BadRequestException('Could not generate upload URL');
    }

    return {
      mediaId: media.id,
      uploadUrl,
      key: media.s3Key,
      type: media.type,
      expiresIn: MEDIA_PRESIGN_TTL_SECONDS,
    };
  }

  /**
   * Confirm a reserved media upload on an author's OWN article: HeadObject reads
   * the authoritative stored size, the per-type byte cap is enforced, and the
   * row flips PENDING -> CONFIRMED. On a size violation the PENDING row + S3
   * object are purged (freeing the cap slot). Idempotent on an already-CONFIRMED
   * row (applies any caption/sortOrder edits).
   */
  async confirmMedia(
    articleId: string,
    mediaId: string,
    authorType: ArticleAuthorType,
    authorId: string,
    dto: ConfirmArticleMediaDto,
  ) {
    await this.assertOwnEditableArticle(articleId, authorType, authorId);

    const media = await this.prisma.articleMedia.findUnique({
      where: { id: mediaId },
    });
    if (!media || media.articleId !== articleId) {
      throw new NotFoundException('Media not found');
    }

    if (media.status === ArticleMediaStatus.CONFIRMED) {
      // Idempotent: apply any metadata edits and return.
      return this.prisma.articleMedia.update({
        where: { id: media.id },
        data: {
          caption: dto.caption ?? media.caption,
          sortOrder: dto.sortOrder ?? media.sortOrder,
        },
      });
    }

    const maxBytes = ARTICLE_MEDIA_MAX_BYTES[media.type];

    // Authoritative size from S3. Do NOT seed actualSize from the spoofable
    // advisory value before HeadObject runs.
    let actualSize: number | undefined;
    let objectExists = false;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: media.s3Key }),
      );
      objectExists = true;
      if (typeof head.ContentLength === 'number') {
        actualSize = head.ContentLength;
      }
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) {
        objectExists = false; // client never completed the PUT
      } else {
        // 403/503/timeout — object may exist but is unverifiable. Refuse to
        // promote (confirming an inaccessible object + advisory-size fallback is
        // a size-enforcement bypass). Surface a retryable error.
        this.logger.warn(
          `HeadObject failed for ${media.s3Key} (status=${status ?? 'unknown'}): ${(e as Error)?.message}`,
        );
        throw new BadRequestException('Upload verification failed; try again');
      }
    }

    // Advisory fallback only when the object was definitively absent AND we are
    // not in production (local dev without a real S3 backing).
    if (!objectExists) {
      if (!this.isProd && typeof dto.fileSize === 'number') {
        actualSize = dto.fileSize;
      } else {
        throw new BadRequestException(
          'Uploaded object not found; complete the upload before confirming',
        );
      }
    }

    if (typeof actualSize === 'number' && actualSize > maxBytes) {
      await this.bestEffortDeleteObject(media.s3Key);
      await this.prisma.articleMedia
        .delete({ where: { id: media.id } })
        .catch(() => undefined);
      this.logger.warn(
        `Rejected oversized ${media.type} article media ${media.id}: ${actualSize} > ${maxBytes} (slot freed, object purged)`,
      );
      throw new BadRequestException(
        `${media.type} exceeds the maximum allowed size of ${maxBytes} bytes`,
      );
    }

    return this.prisma.articleMedia.update({
      where: { id: media.id },
      data: {
        status: ArticleMediaStatus.CONFIRMED,
        caption: dto.caption ?? media.caption,
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  /** Delete a media row (+ best-effort S3 purge) on an author's OWN article. */
  async deleteMedia(
    articleId: string,
    mediaId: string,
    authorType: ArticleAuthorType,
    authorId: string,
  ) {
    await this.assertOwnEditableArticle(articleId, authorType, authorId);

    const media = await this.prisma.articleMedia.findUnique({
      where: { id: mediaId },
    });
    if (!media || media.articleId !== articleId) {
      throw new NotFoundException('Media not found');
    }

    await this.prisma.articleMedia.delete({ where: { id: mediaId } });
    await this.bestEffortDeleteObject(media.s3Key);
    return { id: mediaId, deleted: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN
  // ──────────────────────────────────────────────────────────────────────────

  /** Admin moderation queue: all statuses, filter by status, pagination. */
  async adminList(query: AdminArticleQueryDto) {
    const { page, limit, skip } = this.resolvePaging(query.page, query.limit);

    const where: Prisma.ArticleWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      const term = query.search.trim();
      if (term) {
        where.OR = [
          { title: { contains: term, mode: 'insensitive' } },
          { excerpt: { contains: term, mode: 'insensitive' } },
          { authorName: { contains: term, mode: 'insensitive' } },
        ];
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
        // Triage metadata only — deliberately EXCLUDES the `body` rich-text JSON
        // blob (returned only by the adminGet detail endpoint). Avoids an
        // N×body-size moderation-queue payload and is a data-minimization win.
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          coverS3Key: true,
          status: true,
          tags: true,
          authorType: true,
          authorId: true,
          authorName: true,
          viewCount: true,
          rejectionReason: true,
          reviewedById: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.article.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Admin full detail: the full article (all fields + all media regardless of
   * status) PLUS full view metrics (total views, unique IPs, geo + referrer
   * breakdown) for the article's public path '/articles/<slug>'. These richer
   * metrics are AdminGuard-only — authors never see them.
   */
  async adminGet(id: string) {
    const article = await this.prisma.article.findUnique({
      where: { id },
      include: {
        media: {
          orderBy: [
            { type: 'asc' },
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
          ],
        },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    const metrics = await this.computeAdminMetrics(article.slug);

    return { ...article, metrics };
  }

  /**
   * Approve: CAS SUBMITTED -> PUBLISHED (idempotent, set publishedAt + finalize
   * slug). The conditional updateMany is the compare-and-swap: only a row still
   * in SUBMITTED transitions, so two concurrent approves can't both publish /
   * double-fire. An already-PUBLISHED article returns idempotently. Notifies the
   * author best-effort.
   */
  async approve(id: string, decidedByAdminId: string) {
    const existing = await this.prisma.article.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Article not found');

    if (existing.status === ArticleStatus.PUBLISHED) {
      // Idempotent: already published.
      return this.prisma.article.findUniqueOrThrow({ where: { id } });
    }
    if (existing.status !== ArticleStatus.SUBMITTED) {
      throw new ConflictException({
        code: 'ARTICLE_NOT_PENDING',
        message: `Only a submitted (pending-review) article can be approved; current status is ${existing.status}`,
      });
    }

    // CAS: flip only if STILL SUBMITTED. count===0 means another request won the
    // race (or it was rejected meanwhile) → re-read and branch.
    const cas = await this.prisma.article.updateMany({
      where: { id, status: ArticleStatus.SUBMITTED },
      data: {
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
        reviewedById: decidedByAdminId,
        rejectionReason: null,
      },
    });

    if (cas.count === 0) {
      const fresh = await this.prisma.article.findUnique({ where: { id } });
      if (fresh?.status === ArticleStatus.PUBLISHED) return fresh; // lost race, already published
      throw new ConflictException({
        code: 'ARTICLE_APPROVE_RACE',
        message: 'Article status changed concurrently; reload and retry',
      });
    }

    const published = await this.prisma.article.findUniqueOrThrow({
      where: { id },
    });

    void this.notifyAuthor(
      published.authorType,
      published.authorId,
      `Your article "${published.title}" is now live`,
      `Good news — your article <strong>${this.escape(published.title)}</strong> has been approved and published on Aryavartham.`,
    );

    return published;
  }

  /**
   * Reject: -> REJECTED with a required reason. decidedByAdminId comes from the
   * AdminGuard JWT (never the body). Allowed only from SUBMITTED. Notifies the
   * author best-effort.
   */
  async reject(id: string, decidedByAdminId: string, reason: string) {
    const existing = await this.prisma.article.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Article not found');

    if (existing.status === ArticleStatus.REJECTED) {
      // True idempotency (mirrors approve): a second reject does NOT silently
      // overwrite the original reason / reviewer with a different admin's values
      // under no CAS protection. Refuse instead so the first decision stands.
      throw new ConflictException({
        code: 'ARTICLE_ALREADY_REJECTED',
        message:
          'Article is already rejected; restore it to the queue before re-rejecting with a new reason',
      });
    }
    if (existing.status !== ArticleStatus.SUBMITTED) {
      throw new ConflictException({
        code: 'ARTICLE_NOT_PENDING',
        message: `Only a submitted (pending-review) article can be rejected; current status is ${existing.status}`,
      });
    }

    const cas = await this.prisma.article.updateMany({
      where: { id, status: ArticleStatus.SUBMITTED },
      data: {
        status: ArticleStatus.REJECTED,
        rejectionReason: reason,
        reviewedById: decidedByAdminId,
      },
    });
    if (cas.count === 0) {
      throw new ConflictException({
        code: 'ARTICLE_REJECT_RACE',
        message: 'Article status changed concurrently; reload and retry',
      });
    }

    const rejected = await this.prisma.article.findUniqueOrThrow({
      where: { id },
    });

    void this.notifyAuthor(
      rejected.authorType,
      rejected.authorId,
      `Update on your article "${rejected.title}"`,
      `Your article <strong>${this.escape(rejected.title)}</strong> needs some changes before it can be published.<br/><br/><strong>Reason:</strong> ${this.escape(reason)}<br/><br/>You can edit and re-submit it from your articles page.`,
    );

    return rejected;
  }

  /**
   * Admin edit / feature / unpublish any article.
   *
   * - feature: toggles the reserved FEATURED_TAG (the schema has no isFeatured
   *   column; featuring is modeled as a sentinel tag the public sort honors).
   * - unpublish: there is no ARCHIVED state in the schema, so unpublish pulls a
   *   PUBLISHED article off the public listing by returning it to the moderation
   *   queue (SUBMITTED), clearing publishedAt AND the stale reviewedById (so the
   *   next admin to pick it from the queue is not shown a prior reviewer).
   * - other fields: a free admin content edit.
   *
   * `decidedByAdminId` is pinned from the AdminGuard JWT (never the body). The
   * schema has no `lastEditedById` / edit-history column, so for a forensic trail
   * the acting admin id + the set of changed fields are logged at INFO level —
   * an admin content edit is no longer entirely unaudited (review MEDIUM).
   */
  async adminUpdate(
    id: string,
    decidedByAdminId: string,
    dto: AdminUpdateArticleDto,
  ) {
    const existing = await this.prisma.article.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Article not found');

    // A cover must reference a CONFIRMED image this article owns (same anti-IDOR
    // guard as the author path; applies to admins setting arbitrary keys too).
    if (dto.coverS3Key !== undefined) {
      await this.validateCoverS3Key(dto.coverS3Key, id);
    }

    const data: Prisma.ArticleUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body as Prisma.InputJsonValue;
    if (dto.excerpt !== undefined) data.excerpt = dto.excerpt;
    if (dto.coverS3Key !== undefined) data.coverS3Key = dto.coverS3Key;

    // Compute the next tag set, honoring an explicit tag replace + featured toggle.
    let nextTags =
      dto.tags !== undefined
        ? this.mergeReservedTags(existing.tags, this.normalizeTags(dto.tags))
        : [...existing.tags];
    if (dto.featured !== undefined) {
      nextTags = this.setFeatured(nextTags, dto.featured);
    }
    if (dto.tags !== undefined || dto.featured !== undefined) {
      data.tags = nextTags;
    }

    if (dto.unpublish === true) {
      data.status = ArticleStatus.SUBMITTED;
      data.publishedAt = null;
      // Clear the prior reviewer so the requeued article is a blank slate for the
      // next admin who moderates it (no stale decision attribution).
      data.reviewedById = null;
    }

    const changedFields = Object.keys(data);
    const updated = await this.prisma.article.update({ where: { id }, data });

    this.logger.log(
      `admin ${decidedByAdminId} edited article ${id} (fields: ${
        changedFields.length ? changedFields.join(', ') : 'none'
      })`,
    );

    return updated;
  }

  /**
   * Restore: re-publish an article (e.g. one that was unpublished back to the
   * queue, or a rejected one an admin wants to force live). CAS-free admin
   * action: sets PUBLISHED + publishedAt if not already published. Idempotent.
   */
  async restore(id: string, decidedByAdminId: string) {
    const existing = await this.prisma.article.findUnique({
      where: { id },
      select: { id: true, status: true, publishedAt: true },
    });
    if (!existing) throw new NotFoundException('Article not found');
    if (existing.status === ArticleStatus.PUBLISHED) {
      return this.prisma.article.findUniqueOrThrow({ where: { id } });
    }
    return this.prisma.article.update({
      where: { id },
      data: {
        status: ArticleStatus.PUBLISHED,
        publishedAt: existing.publishedAt ?? new Date(),
        reviewedById: decidedByAdminId,
        rejectionReason: null,
      },
    });
  }

  /**
   * Delete an article.
   *
   * IMPORTANT: the Article model has NO `deletedAt` column in the current schema
   * (and editing the schema is out of scope), so a true soft-delete is not
   * possible. This performs a HARD delete (ArticleMedia rows cascade via the FK)
   * and best-effort purges each media object from S3. This is flagged as an open
   * concern: to honor a real soft-delete, add `Article.deletedAt` + a migration.
   */
  async remove(id: string) {
    const existing = await this.prisma.article.findUnique({
      where: { id },
      select: {
        id: true,
        media: { select: { s3Key: true } },
      },
    });
    if (!existing) throw new NotFoundException('Article not found');

    await this.prisma.article.delete({ where: { id } });
    // Best-effort purge of all media objects (the rows cascade-deleted already).
    await Promise.all(
      existing.media.map((m) => this.bestEffortDeleteObject(m.s3Key)),
    );

    return { id, deleted: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /** Resolve page/limit/skip with sane bounds. */
  private resolvePaging(
    pageIn?: number,
    limitIn?: number,
  ): { page: number; limit: number; skip: number } {
    const page = pageIn && pageIn > 0 ? Math.trunc(pageIn) : 1;
    const limit =
      limitIn && limitIn > 0
        ? Math.min(Math.trunc(limitIn), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;
    return { page, limit, skip: (page - 1) * limit };
  }

  /**
   * Trim, lowercase, drop empties, de-dupe, and strip reserved tags from a user
   * tag list.
   *
   * Tags are stored LOWERCASED so the GIN array-overlap (&&) used by related
   * articles is case-insensitive by construction: `['React']` and `['react']`
   * both persist as `react` and therefore relate. Lowercased storage also makes
   * `mergeReservedTags` de-duplication consistent regardless of incoming casing.
   * The reserved FEATURED_TAG sentinel is already lowercase, so the equality
   * check below still excludes it correctly.
   */
  private normalizeTags(tags?: string[]): string[] {
    if (!tags) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
      const t = String(raw).trim().toLowerCase();
      if (!t) continue;
      if (t === FEATURED_TAG) continue; // authors/clients cannot set reserved tags
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  /**
   * Hide reserved/internal tags from any externally-returned tag list. Pure
   * transform with no service state → `private static`.
   */
  private static visibleTags(tags: string[]): string[] {
    return tags.filter((t) => t !== FEATURED_TAG);
  }

  /**
   * Merge a fresh user-supplied tag set with the reserved tags currently on the
   * row (so a user/admin tag replace cannot accidentally drop the featured flag).
   */
  private mergeReservedTags(current: string[], next: string[]): string[] {
    const reserved = current.filter((t) => t === FEATURED_TAG);
    return [...next, ...reserved];
  }

  /** Add or remove the reserved featured tag. */
  private setFeatured(tags: string[], featured: boolean): string[] {
    const withoutFlag = tags.filter((t) => t !== FEATURED_TAG);
    return featured ? [...withoutFlag, FEATURED_TAG] : withoutFlag;
  }

  /**
   * Shape a raw row into the public list/related item (reserved tags hidden).
   * Pure transform with no service state → `private static` (no `this`).
   * `viewCount` is intentionally NOT exposed on public surfaces (review HIGH).
   */
  private static toPublicListItem(r: {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    coverS3Key: string | null;
    tags: string[];
    authorName: string | null;
    publishedAt: Date | null;
  }) {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      coverS3Key: r.coverS3Key,
      tags: ArticlesService.visibleTags(r.tags),
      isFeatured: r.tags.includes(FEATURED_TAG),
      authorName: r.authorName,
      publishedAt: r.publishedAt,
    };
  }

  /**
   * Resolve the author's denormalized display name from the verified identity.
   * Both Applicant and Customer carry firstName/lastName. Returns null if the
   * row can't be resolved (the article still saves; authorName is best-effort).
   */
  private async resolveAuthorName(
    authorType: ArticleAuthorType,
    authorId: string,
  ): Promise<string | null> {
    try {
      if (authorType === ArticleAuthorType.APPLICANT) {
        const a = await this.prisma.applicant.findUnique({
          where: { id: authorId },
          select: { firstName: true, lastName: true },
        });
        return a ? this.joinName(a.firstName, a.lastName) : null;
      }
      const c = await this.prisma.customer.findUnique({
        where: { id: authorId },
        select: { firstName: true, lastName: true },
      });
      return c ? this.joinName(c.firstName, c.lastName) : null;
    } catch (e) {
      this.logger.warn(
        `resolveAuthorName failed for ${authorType}:${authorId}: ${(e as Error)?.message}`,
      );
      return null;
    }
  }

  private joinName(first?: string | null, last?: string | null): string | null {
    const name = [first, last].filter(Boolean).join(' ').trim();
    return name || null;
  }

  /**
   * Resolve the author's contact email for best-effort notifications, by type.
   */
  private async resolveAuthorEmail(
    authorType: ArticleAuthorType,
    authorId: string,
  ): Promise<{ email: string | null; firstName: string | null }> {
    if (authorType === ArticleAuthorType.APPLICANT) {
      const a = await this.prisma.applicant.findUnique({
        where: { id: authorId },
        select: { email: true, firstName: true },
      });
      return { email: a?.email ?? null, firstName: a?.firstName ?? null };
    }
    const c = await this.prisma.customer.findUnique({
      where: { id: authorId },
      select: { email: true, firstName: true },
    });
    return { email: c?.email ?? null, firstName: c?.firstName ?? null };
  }

  /**
   * Best-effort author email notification. Never throws — a notification failure
   * must not block the moderation transition (mirrors NotificationService).
   */
  private async notifyAuthor(
    authorType: ArticleAuthorType,
    authorId: string,
    subject: string,
    htmlInner: string,
  ): Promise<void> {
    try {
      const { email, firstName } = await this.resolveAuthorEmail(
        authorType,
        authorId,
      );
      if (!email) return;
      const greeting = firstName?.trim()
        ? this.escape(firstName.trim())
        : 'there';
      await this.email.sendEmail({
        to: email,
        subject,
        htmlBody: `<p>Hi ${greeting},</p><p>${htmlInner}</p><p>— The Aryavartham Team</p>`,
      });
    } catch (e) {
      this.logger.error(
        `Best-effort author notification failed for ${authorType}:${authorId}: ${(e as Error)?.message}`,
      );
    }
  }

  /** Minimal HTML-escape for interpolated user-controlled strings in emails. */
  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Author-editable states for MEDIA management: SUBMITTED and REJECTED.
   *
   * The architecture (Section 4.14 / Section 9) models presign/confirm as part of
   * the authoring flow — the row-reservation cap is exercised on the submit path,
   * not only on the re-edit-after-rejection path. A freshly created article is in
   * SUBMITTED, so SUBMITTED MUST be media-editable or the author can never attach
   * media to a just-submitted piece (a PENDING row would be reserved at presign
   * but the confirm would 409, leaving an orphan slot). REJECTED stays editable
   * so the author can fix up media before re-submitting. PUBLISHED is the admin's.
   */
  private static readonly MEDIA_EDITABLE_STATES: readonly ArticleStatus[] = [
    ArticleStatus.SUBMITTED,
    ArticleStatus.REJECTED,
  ];

  /**
   * Assert the article exists, is owned by (authorType, authorId), and is in an
   * author-editable state (SUBMITTED or REJECTED) so the author can manage its
   * media. A not-found / not-owned article yields 404; a wrong-state one yields
   * 409.
   *
   * Media management is allowed while the article is still the author's to shape:
   * SUBMITTED (attach media to a freshly submitted piece) and REJECTED (fix media
   * before re-submitting). Once PUBLISHED it is the admin's, so the author can no
   * longer swap media on a live piece.
   */
  private async assertOwnEditableArticle(
    articleId: string,
    authorType: ArticleAuthorType,
    authorId: string,
  ): Promise<void> {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, authorType: true, authorId: true, status: true },
    });
    if (
      !article ||
      article.authorType !== authorType ||
      article.authorId !== authorId
    ) {
      throw new NotFoundException('Article not found');
    }
    if (!ArticlesService.MEDIA_EDITABLE_STATES.includes(article.status)) {
      throw new ConflictException({
        code: 'ARTICLE_NOT_EDITABLE',
        message:
          'Media can only be managed on a submitted or rejected article you own',
      });
    }
  }

  /**
   * Validate the requested media MIME against the allowlist for `type` and ensure
   * the file-name extension matches. Returns a sanitized basename (no path
   * traversal) + the normalized MIME to sign/store. Mirrors store-media.
   */
  private validateMediaUploadInput(
    type: ArticleMediaType,
    fileName: string,
    mimeType: string,
  ): { safeFileName: string; normalizedMimeType: string } {
    if (typeof fileName !== 'string' || typeof mimeType !== 'string') {
      throw new BadRequestException('fileName and mimeType are required');
    }
    const allowMap = ALLOWED_ARTICLE_MEDIA_MIME[type];
    if (!allowMap) {
      throw new BadRequestException(`Unsupported media type: ${String(type)}`);
    }
    const normalizedMimeType = mimeType.trim().toLowerCase();
    const allowedExtensions = allowMap[normalizedMimeType];
    if (!allowedExtensions) {
      throw new BadRequestException(`Unsupported ${type} type: ${mimeType}`);
    }
    // Strip directory components to prevent path traversal in the S3 key.
    const baseName = fileName.replace(/^.*[\\/]/, '').trim();
    if (!baseName || baseName === '.' || baseName === '..') {
      throw new BadRequestException('Invalid file name');
    }
    const dotIndex = baseName.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === baseName.length - 1) {
      throw new BadRequestException('File name must include a valid extension');
    }
    const extension = baseName.slice(dotIndex + 1).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        `File extension ".${extension}" does not match the declared type ${normalizedMimeType}`,
      );
    }
    // Normalize to a strict safe-filename allowlist (UUID prefix guarantees
    // uniqueness; this removes %, ?, #, spaces, Unicode, control chars).
    const safeFileName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
      throw new BadRequestException('Invalid file name');
    }
    return { safeFileName, normalizedMimeType };
  }

  /**
   * Article S3 key prefix matcher. The articles key space is
   * `articles/{articleId}/{type}/{uuid}-{filename}` (articleId is a UUID). Any
   * accepted cover key MUST live under this prefix — this blocks cross-bucket
   * prefixes (`invoices/`, `labels/`), path-traversal attempts, and dangling
   * keys that point outside the articles namespace.
   */
  private static readonly ARTICLE_KEY_PREFIX = /^articles\/[0-9a-fA-F-]{36}\//;

  /**
   * Validate a client-/admin-supplied `coverS3Key`.
   *
   * Defends against arbitrary S3-key injection (cross-article cover hijacking,
   * dangling references, path traversal, foreign-prefix keys). The shape check
   * confirms the key lives under `articles/{uuid}/`. When `articleId` is known
   * (edit paths) the STRONGER check is applied: the key must belong to a
   * CONFIRMED ArticleMedia IMAGE row on THIS article, so a cover can only be set
   * from media the author actually uploaded to this article.
   */
  private async validateCoverS3Key(
    key: string,
    articleId?: string,
  ): Promise<void> {
    if (!ArticlesService.ARTICLE_KEY_PREFIX.test(key)) {
      throw new BadRequestException({
        code: 'INVALID_COVER_KEY',
        message: 'coverS3Key must reference an uploaded article image',
      });
    }
    if (articleId) {
      // It must also fall under THIS article's own prefix and correspond to a
      // CONFIRMED image this article owns — not another article's media.
      if (!key.startsWith(`articles/${articleId}/`)) {
        throw new BadRequestException({
          code: 'INVALID_COVER_KEY',
          message: 'coverS3Key does not belong to this article',
        });
      }
      const owned = await this.prisma.articleMedia.findFirst({
        where: {
          articleId,
          s3Key: key,
          type: ArticleMediaType.IMAGE,
          status: ArticleMediaStatus.CONFIRMED,
        },
        select: { id: true },
      });
      if (!owned) {
        throw new BadRequestException({
          code: 'INVALID_COVER_KEY',
          message:
            'coverS3Key must reference a confirmed image uploaded to this article',
        });
      }
    }
  }

  /** Best-effort S3 object delete; never throws (cleanup path). */
  private async bestEffortDeleteObject(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (e) {
      this.logger.warn(
        `Best-effort S3 delete failed for ${key}: ${(e as Error)?.message}`,
      );
    }
  }

  /**
   * Full admin view metrics for an article's public path '/articles/<slug>',
   * read from the existing DailyPageStat rollup + Visitor table (the same source
   * the store/visitor admin surfaces use). AdminGuard-only — never exposed to
   * authors. Best-effort: a metrics-read failure returns zeros rather than
   * failing the whole detail fetch.
   */
  private async computeAdminMetrics(slug: string) {
    const path = `/articles/${slug}`;
    try {
      // Aggregate views + unique IPs from the daily rollup for this path.
      const daily = await this.prisma.dailyPageStat.aggregate({
        where: { path },
        _sum: { views: true, uniqueIps: true },
      });

      // Per-day trend (newest first).
      const trend = await this.prisma.dailyPageStat.findMany({
        where: { path },
        orderBy: { date: 'desc' },
        take: 90,
        select: { date: true, views: true, uniqueIps: true, avgDuration: true },
      });

      // Geo + referrer breakdown from the Visitor history JSON for this path.
      // Parameterized raw SQL; bounded LIMIT. Visitors store an array of
      // { path, timestamp, ... } history entries — we count visitors whose
      // history contains an entry for this path, grouped by country.
      const geo = await this.prisma.$queryRaw<
        Array<{ country: string | null; visitors: number }>
      >`
        SELECT v.country AS country, COUNT(DISTINCT v.id)::int AS visitors
        FROM visitors v
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(v.history) AS h(elem)
          WHERE h.elem->>'path' = ${path}
        )
        GROUP BY v.country
        ORDER BY visitors DESC
        LIMIT 50
      `;

      // Referrer breakdown from the per-path history entries.
      const referrers = await this.prisma.$queryRaw<
        Array<{ referrer: string | null; hits: number }>
      >`
        SELECT h.elem->>'referrer' AS referrer, COUNT(*)::int AS hits
        FROM visitors v, jsonb_array_elements(v.history) AS h(elem)
        WHERE h.elem->>'path' = ${path}
        GROUP BY h.elem->>'referrer'
        ORDER BY hits DESC
        LIMIT 50
      `;

      return {
        path,
        totalViews: daily._sum.views ?? 0,
        uniqueIps: daily._sum.uniqueIps ?? 0,
        dailyTrend: trend.map((t) => ({
          date: t.date.toISOString().split('T')[0],
          views: t.views,
          uniqueIps: t.uniqueIps,
          avgDuration: t.avgDuration,
        })),
        geo,
        referrers,
      };
    } catch (e) {
      this.logger.warn(
        `computeAdminMetrics failed for ${path}: ${(e as Error)?.message}`,
      );
      return {
        path,
        totalViews: 0,
        uniqueIps: 0,
        dailyTrend: [],
        geo: [],
        referrers: [],
      };
    }
  }
}
