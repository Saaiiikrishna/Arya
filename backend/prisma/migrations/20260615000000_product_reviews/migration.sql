-- Product reviews & ratings (Section: PRODUCT REVIEWS & RATINGS).
-- Creates the reviews table (one review per customer per product, moderation
-- lifecycle via ReviewStatus, optional verified-purchase order linkage) and adds
-- the denormalized review aggregate columns (rating_count, rating_sum) to products
-- so list/detail reads never N+1 over reviews. avg = rating_sum / rating_count
-- computed at read; integer columns avoid float drift. UUID id has no DB default
-- (app-side @default(uuid()); no pgcrypto). Additive + idempotent (IF NOT EXISTS /
-- duplicate_object guards). The ReviewStatus enum is created here (re-runnable).

-- ─── ENUM ────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── DENORMALIZED PRODUCT AGGREGATE ──────────────────────
-- Updated atomically by the reviews service on approve/reject — never inline.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "rating_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "rating_sum" INTEGER NOT NULL DEFAULT 0;

-- ─── TABLE ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "reviews" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "is_verified_purchase" BOOLEAN NOT NULL DEFAULT false,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- ─── CHECK CONSTRAINT ────────────────────────────────────
-- rating must be 1..5. Added via guarded ALTER so the migration is re-runnable.

DO $$ BEGIN
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── UNIQUE INDEXES ──────────────────────────────────────
-- One review per customer per product.

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_product_id_customer_id_key" ON "reviews"("product_id", "customer_id");

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "reviews_product_id_status_idx" ON "reviews"("product_id", "status");
CREATE INDEX IF NOT EXISTS "reviews_customer_id_idx" ON "reviews"("customer_id");

-- ─── FOREIGN KEYS ────────────────────────────────────────
-- product → Cascade (reviews go with the product); customer → Restrict (preserve
-- review history / aggregate integrity); order → SetNull (verified-purchase linkage
-- survives order deletion).

DO $$ BEGIN
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
