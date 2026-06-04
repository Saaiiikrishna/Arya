-- Articles vertical (Section 2.7): articles, article_media (+ status, row-reserved
-- cap pattern). Includes the SQL-only GIN index on articles.tags for the
-- related-articles array-overlap (&&) query (expected migrate-diff delta).
-- UUID columns have no DB default.

-- ─── TABLES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "articles" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "excerpt" TEXT,
    "cover_s3_key" TEXT,
    "author_type" "ArticleAuthorType" NOT NULL,
    "author_id" UUID NOT NULL,
    "author_name" TEXT,
    "status" "ArticleStatus" NOT NULL DEFAULT 'SUBMITTED',
    "tags" TEXT[] NOT NULL DEFAULT '{}', -- never null: GIN array-overlap (&&) silently skips null rows
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "reviewed_by_id" TEXT,
    "rejection_reason" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "article_media" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "type" "ArticleMediaType" NOT NULL DEFAULT 'IMAGE',
    "status" "ArticleMediaStatus" NOT NULL DEFAULT 'PENDING',
    "s3_key" TEXT NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_media_pkey" PRIMARY KEY ("id")
);

-- ─── UNIQUE INDEXES ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "articles_slug_key" ON "articles"("slug");

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "articles_status_idx" ON "articles"("status");
CREATE INDEX IF NOT EXISTS "articles_author_type_author_id_idx" ON "articles"("author_type", "author_id");
-- (no articles_slug_idx — the articles_slug_key UNIQUE index already covers slug lookups)
CREATE INDEX IF NOT EXISTS "articles_published_at_idx" ON "articles"("published_at");
CREATE INDEX IF NOT EXISTS "article_media_article_id_type_status_idx" ON "article_media"("article_id", "type", "status");

-- GIN index on tags for the related-articles array-overlap (&&) query.
-- SQL-only (Prisma models it as a plain @@index) — expected migrate-diff delta.
CREATE INDEX IF NOT EXISTS "articles_tags_gin" ON "articles" USING GIN ("tags");

-- ─── FOREIGN KEYS ────────────────────────────────────────
-- NOTE: articles.author_id is intentionally NOT a DB foreign key — it is a
-- polymorphic reference resolved by author_type (CUSTOMER → customers.id,
-- APPLICANT → applicants.id), pinned from the verified JWT at submit time.

DO $$ BEGIN
  ALTER TABLE "article_media" ADD CONSTRAINT "article_media_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
