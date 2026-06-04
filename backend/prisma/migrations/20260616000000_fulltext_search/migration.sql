-- Full-text search for products + articles (Section: FULL-TEXT SEARCH).
-- Adds a Postgres GENERATED ALWAYS (STORED) tsvector column + GIN index on BOTH
-- products and articles. SQL-only (NOT modeled in Prisma) — mirrors the existing
-- SQL-only "articles_tags_gin" index that is intentionally not in the schema. The
-- search service queries these via $queryRaw with websearch_to_tsquery + ts_rank.
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
--
-- COLUMN-NAME VERIFICATION (against schema.prisma @map values):
--   products: name (no @map → "name"), short_description (shortDescription),
--             brand (no @map → "brand") all exist. There is NO "description" column
--             on products — the closest long-text descriptive field is
--             "seo_description" (seoDescription @db.Text), substituted into the
--             C-weight slot the spec assigned to "description".
--   articles: title (no @map → "title") and excerpt (no @map → "excerpt") both exist.

-- ─── PRODUCTS ────────────────────────────────────────────
-- Weights: A=name, B=short_description, C=seo_description (substituted for the
-- non-existent "description"), B=brand.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("short_description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("seo_description", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("brand", '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "products_search_vector_gin" ON "products" USING GIN ("search_vector");

-- ─── ARTICLES ────────────────────────────────────────────
-- Weights: A=title, B=excerpt.

ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("excerpt", '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "articles_search_vector_gin" ON "articles" USING GIN ("search_vector");
