-- Commerce catalog (Section 2.2): categories, tax_classes, tax_rates, products,
-- product_media (+ status), product_tabs, product_tab_sections, skus, price_tiers.
-- All money is integer paise. UUID columns have no DB default (app-side @default(uuid())).
-- Tables created first (parents → children); FKs added after; indexes last.

-- ─── TABLES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tax_classes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaxRateType" NOT NULL DEFAULT 'GST',
    "hsn_code" TEXT,
    "cgst_bps" INTEGER NOT NULL DEFAULT 0,
    "sgst_bps" INTEGER NOT NULL DEFAULT 0,
    "igst_bps" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_classes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tax_rates" (
    "id" UUID NOT NULL,
    "hsn_code" TEXT NOT NULL,
    "type" "TaxRateType" NOT NULL DEFAULT 'GST',
    "total_gst_bps" INTEGER NOT NULL,
    "description" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "products" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "brand" TEXT,
    "short_description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "ProductType" NOT NULL DEFAULT 'STANDARD',
    "category_id" UUID,
    "category" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT '{}', -- never null
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "ProductMediaType" NOT NULL DEFAULT 'IMAGE',
    "status" "ProductMediaStatus" NOT NULL DEFAULT 'PENDING',
    "s3_key" TEXT NOT NULL,
    "url" TEXT,
    "caption" TEXT,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_tabs" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tabs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_tab_sections" (
    "id" UUID NOT NULL,
    "tab_id" UUID NOT NULL,
    "type" "ProductTabSectionType" NOT NULL DEFAULT 'RICH_TEXT',
    "title" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tab_sections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skus" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku_code" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT,
    "variant_attributes" JSONB NOT NULL DEFAULT '{}',
    "hsn_code" TEXT,
    "tax_class_id" UUID,
    "base_price" INTEGER NOT NULL,
    "sale_price" INTEGER,
    "sale_starts_at" TIMESTAMP(3),
    "sale_ends_at" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "weight_grams" INTEGER,
    "length_mm" INTEGER,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "reorder_qty" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "price_tiers" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "kind" "PriceTierKind" NOT NULL DEFAULT 'QUANTITY',
    "min_qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- ─── UNIQUE INDEXES ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_key" ON "categories"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "tax_classes_name_key" ON "tax_classes"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "tax_rates_hsn_code_key" ON "tax_rates"("hsn_code");
CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_key" ON "products"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "skus_sku_code_key" ON "skus"("sku_code");
CREATE UNIQUE INDEX IF NOT EXISTS "skus_barcode_key" ON "skus"("barcode");
CREATE UNIQUE INDEX IF NOT EXISTS "price_tiers_sku_id_min_qty_key" ON "price_tiers"("sku_id", "min_qty");

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "categories_parent_id_idx" ON "categories"("parent_id");
CREATE INDEX IF NOT EXISTS "tax_classes_hsn_code_idx" ON "tax_classes"("hsn_code");
CREATE INDEX IF NOT EXISTS "tax_classes_is_active_idx" ON "tax_classes"("is_active");
CREATE INDEX IF NOT EXISTS "tax_rates_hsn_code_idx" ON "tax_rates"("hsn_code");
CREATE INDEX IF NOT EXISTS "products_status_idx" ON "products"("status");
CREATE INDEX IF NOT EXISTS "products_category_id_idx" ON "products"("category_id");
CREATE INDEX IF NOT EXISTS "products_is_featured_idx" ON "products"("is_featured");
CREATE INDEX IF NOT EXISTS "products_sort_order_idx" ON "products"("sort_order");
-- (no products_slug_idx — the products_slug_key UNIQUE index already covers slug lookups)
CREATE INDEX IF NOT EXISTS "product_media_product_id_type_status_idx" ON "product_media"("product_id", "type", "status");
CREATE INDEX IF NOT EXISTS "product_media_product_id_sort_order_idx" ON "product_media"("product_id", "sort_order");
CREATE INDEX IF NOT EXISTS "product_tabs_product_id_sort_order_idx" ON "product_tabs"("product_id", "sort_order");
CREATE INDEX IF NOT EXISTS "product_tab_sections_tab_id_sort_order_idx" ON "product_tab_sections"("tab_id", "sort_order");
CREATE INDEX IF NOT EXISTS "skus_product_id_idx" ON "skus"("product_id");
CREATE INDEX IF NOT EXISTS "skus_tax_class_id_idx" ON "skus"("tax_class_id");
CREATE INDEX IF NOT EXISTS "skus_is_active_idx" ON "skus"("is_active");
CREATE INDEX IF NOT EXISTS "price_tiers_sku_id_idx" ON "price_tiers"("sku_id");

-- ─── FOREIGN KEYS ────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "product_tabs" ADD CONSTRAINT "product_tabs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "product_tab_sections" ADD CONSTRAINT "product_tab_sections_tab_id_fkey" FOREIGN KEY ("tab_id") REFERENCES "product_tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "skus" ADD CONSTRAINT "skus_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "skus" ADD CONSTRAINT "skus_tax_class_id_fkey" FOREIGN KEY ("tax_class_id") REFERENCES "tax_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
