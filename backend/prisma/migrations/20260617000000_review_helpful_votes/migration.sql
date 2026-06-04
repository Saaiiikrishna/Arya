-- Review helpful-vote junction (Section: PRODUCT REVIEWS & RATINGS — true per-user
-- helpful-vote dedupe). Replaces the coarse per-IP Redis gate with a junction table
-- so a given customer can register at most ONE helpful vote per review, enforced by
-- a unique (review_id, customer_id) index. A second vote surfaces as a P2002 the
-- service swallows idempotently (no double count). UUID id has no DB default
-- (app-side @default(uuid()); no pgcrypto). Additive + idempotent (IF NOT EXISTS /
-- duplicate_object guards) so it is re-runnable.

-- ─── TABLE ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "review_helpful_votes" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_helpful_votes_pkey" PRIMARY KEY ("id")
);

-- ─── UNIQUE INDEX ────────────────────────────────────────
-- One helpful vote per customer per review.

CREATE UNIQUE INDEX IF NOT EXISTS "review_helpful_votes_review_id_customer_id_key" ON "review_helpful_votes"("review_id", "customer_id");

-- ─── SECONDARY INDEX ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS "review_helpful_votes_customer_id_idx" ON "review_helpful_votes"("customer_id");

-- ─── FOREIGN KEYS ────────────────────────────────────────
-- Both Cascade: a vote is meaningless once its review or customer is gone.

DO $$ BEGIN
  ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
