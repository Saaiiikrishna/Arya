-- Commerce DIY & bundles (Section 2.6): component_bundles, bundle_items,
-- diy_guides, diy_steps, diy_bom_items (with the CHECK constraint enforcing at
-- least one identity column). Bundle↔Sku and Bundle↔Product FKs (SetNull),
-- diy_guides.bundle_id FK. UUID columns have no DB default.

-- ─── TABLES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "component_bundles" (
    "id" UUID NOT NULL,
    "product_id" UUID,
    "bundle_sku_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "component_bundles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bundle_items" (
    "id" UUID NOT NULL,
    "bundle_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bundle_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "diy_guides" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "difficulty" TEXT,
    "estimated_minutes" INTEGER,
    "bundle_id" UUID,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diy_guides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "diy_steps" (
    "id" UUID NOT NULL,
    "guide_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "code_language" TEXT,
    "code" TEXT,
    "media" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diy_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "diy_bom_items" (
    "id" UUID NOT NULL,
    "guide_id" UUID NOT NULL,
    "sku_id" UUID,
    "product_id" UUID,
    "free_text_name" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diy_bom_items_pkey" PRIMARY KEY ("id")
);

-- ─── UNIQUE INDEXES ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "component_bundles_product_id_key" ON "component_bundles"("product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "component_bundles_bundle_sku_id_key" ON "component_bundles"("bundle_sku_id");
CREATE UNIQUE INDEX IF NOT EXISTS "bundle_items_bundle_id_sku_id_key" ON "bundle_items"("bundle_id", "sku_id");
CREATE UNIQUE INDEX IF NOT EXISTS "diy_guides_product_id_key" ON "diy_guides"("product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "diy_guides_bundle_id_key" ON "diy_guides"("bundle_id");

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "component_bundles_is_active_idx" ON "component_bundles"("is_active");
CREATE INDEX IF NOT EXISTS "bundle_items_bundle_id_idx" ON "bundle_items"("bundle_id");
CREATE INDEX IF NOT EXISTS "bundle_items_sku_id_idx" ON "bundle_items"("sku_id");
CREATE INDEX IF NOT EXISTS "diy_guides_is_published_idx" ON "diy_guides"("is_published");
CREATE INDEX IF NOT EXISTS "diy_steps_guide_id_sort_order_idx" ON "diy_steps"("guide_id", "sort_order");
CREATE INDEX IF NOT EXISTS "diy_bom_items_guide_id_sort_order_idx" ON "diy_bom_items"("guide_id", "sort_order");
CREATE INDEX IF NOT EXISTS "diy_bom_items_sku_id_idx" ON "diy_bom_items"("sku_id");
CREATE INDEX IF NOT EXISTS "diy_bom_items_product_id_idx" ON "diy_bom_items"("product_id");

-- ─── CHECK CONSTRAINT ────────────────────────────────────
-- A BOM line must carry at least one identity: a purchasable SKU, a cross-linked
-- product, or a free-text tool name. SQL-only (Prisma can't model it) — expected delta.
DO $$ BEGIN
  ALTER TABLE "diy_bom_items" ADD CONSTRAINT "diy_bom_items_identity_check"
    CHECK ("sku_id" IS NOT NULL OR "product_id" IS NOT NULL OR "free_text_name" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── FOREIGN KEYS ────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "component_bundles" ADD CONSTRAINT "component_bundles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "component_bundles" ADD CONSTRAINT "component_bundles_bundle_sku_id_fkey" FOREIGN KEY ("bundle_sku_id") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "component_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "diy_guides" ADD CONSTRAINT "diy_guides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "diy_guides" ADD CONSTRAINT "diy_guides_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "component_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "diy_steps" ADD CONSTRAINT "diy_steps_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "diy_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "diy_bom_items" ADD CONSTRAINT "diy_bom_items_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "diy_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "diy_bom_items" ADD CONSTRAINT "diy_bom_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "diy_bom_items" ADD CONSTRAINT "diy_bom_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
