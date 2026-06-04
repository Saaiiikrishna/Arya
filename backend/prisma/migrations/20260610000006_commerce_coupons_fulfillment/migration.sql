-- Commerce coupons & fulfillment (Section 2.5): coupons (+ allow_guest),
-- coupon_redemptions (+ redeemer_email/redeemer_phone + anti-farming index on
-- (coupon_id, redeemer_email)), shipments, shipment_events, returns, return_items,
-- invoices (+ UNIQUE(financial_year, sequence_no)), invoice_lines, invoice_sequences.
-- Adds the deferred orders.coupon_id and carts.coupon_id → coupons FKs.
-- Money is integer paise. UUID columns have no DB default.

-- ─── TABLES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "CouponType" NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "max_discount" INTEGER,
    "min_order_value" INTEGER NOT NULL DEFAULT 0,
    "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "usage_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "per_customer_limit" INTEGER NOT NULL DEFAULT 1,
    "allow_guest" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "redeemer_email" TEXT,
    "redeemer_phone" TEXT,
    "order_id" UUID NOT NULL,
    "discount_applied" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "courier" "Courier" NOT NULL DEFAULT 'OTHER',
    "awb" TEXT,
    "tracking_url" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "shipping_cost" INTEGER NOT NULL DEFAULT 0,
    "weight_grams" INTEGER,
    "label_s3_key" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "courier_event_id" TEXT,
    "description" TEXT,
    "location" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "returns" (
    "id" UUID NOT NULL,
    "rma_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL DEFAULT 'OTHER',
    "comment" TEXT,
    "refund_amount" INTEGER NOT NULL DEFAULT 0,
    "refund_status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "razorpay_refund_id" TEXT,
    "restock_warehouse_id" UUID,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "return_items" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "sku_id" UUID,
    "quantity" INTEGER NOT NULL,
    "refund_amount" INTEGER NOT NULL DEFAULT 0,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invoices" (
    "id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'TAX_INVOICE',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "order_id" UUID NOT NULL,
    "financial_year" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "seller_name" TEXT NOT NULL,
    "seller_gstin" TEXT,
    "seller_state_code" TEXT,
    "buyer_name" TEXT NOT NULL,
    "buyer_gstin" TEXT,
    "place_of_supply_state" TEXT,
    "is_inter_state" BOOLEAN NOT NULL DEFAULT false,
    "taxable_value" INTEGER NOT NULL DEFAULT 0,
    "cgst_total" INTEGER NOT NULL DEFAULT 0,
    "sgst_total" INTEGER NOT NULL DEFAULT 0,
    "igst_total" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL DEFAULT 0,
    "pdf_s3_key" TEXT,
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "hsn_code" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "taxable_value" INTEGER NOT NULL,
    "cgst_bps" INTEGER NOT NULL DEFAULT 0,
    "sgst_bps" INTEGER NOT NULL DEFAULT 0,
    "igst_bps" INTEGER NOT NULL DEFAULT 0,
    "cgst_amount" INTEGER NOT NULL DEFAULT 0,
    "sgst_amount" INTEGER NOT NULL DEFAULT 0,
    "igst_amount" INTEGER NOT NULL DEFAULT 0,
    "line_total" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- FY-keyed gapless invoice counter (PK = financial_year). New FY rows are created
-- atomically inside the numbering transaction (INSERT ... ON CONFLICT DO NOTHING +
-- FOR UPDATE) so two replicas cannot race on the first invoice of a new FY.
CREATE TABLE IF NOT EXISTS "invoice_sequences" (
    "financial_year" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT NOT NULL DEFAULT 'ARYA',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("financial_year")
);

-- ─── UNIQUE INDEXES ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_key" ON "coupons"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_redemptions_coupon_id_order_id_key" ON "coupon_redemptions"("coupon_id", "order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_awb_key" ON "shipments"("awb");
-- CAVEAT: Postgres treats NULLs in a composite UNIQUE as distinct, so this guarantees
-- idempotent ingest ONLY when courier_event_id is non-null. The tracking-ingest service
-- MUST synthesize a stable dedupe id for providers that return no event id (never insert NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_events_shipment_id_courier_event_id_key" ON "shipment_events"("shipment_id", "courier_event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "returns_rma_number_key" ON "returns"("rma_number");
CREATE UNIQUE INDEX IF NOT EXISTS "returns_razorpay_refund_id_key" ON "returns"("razorpay_refund_id");
CREATE UNIQUE INDEX IF NOT EXISTS "return_items_return_id_order_item_id_key" ON "return_items"("return_id", "order_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_financial_year_sequence_no_key" ON "invoices"("financial_year", "sequence_no");

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "coupons_status_idx" ON "coupons"("status");
CREATE INDEX IF NOT EXISTS "coupons_expires_at_idx" ON "coupons"("expires_at");
CREATE INDEX IF NOT EXISTS "coupon_redemptions_coupon_id_redeemer_email_idx" ON "coupon_redemptions"("coupon_id", "redeemer_email");
CREATE INDEX IF NOT EXISTS "coupon_redemptions_coupon_id_customer_id_idx" ON "coupon_redemptions"("coupon_id", "customer_id");
CREATE INDEX IF NOT EXISTS "coupon_redemptions_customer_id_idx" ON "coupon_redemptions"("customer_id");
CREATE INDEX IF NOT EXISTS "shipments_order_id_idx" ON "shipments"("order_id");
CREATE INDEX IF NOT EXISTS "shipments_status_idx" ON "shipments"("status");
CREATE INDEX IF NOT EXISTS "shipments_awb_idx" ON "shipments"("awb");
CREATE INDEX IF NOT EXISTS "shipments_last_synced_at_idx" ON "shipments"("last_synced_at");
CREATE INDEX IF NOT EXISTS "shipment_events_shipment_id_idx" ON "shipment_events"("shipment_id");
CREATE INDEX IF NOT EXISTS "shipment_events_occurred_at_idx" ON "shipment_events"("occurred_at");
CREATE INDEX IF NOT EXISTS "returns_order_id_idx" ON "returns"("order_id");
CREATE INDEX IF NOT EXISTS "returns_customer_id_idx" ON "returns"("customer_id");
CREATE INDEX IF NOT EXISTS "returns_status_idx" ON "returns"("status");
CREATE INDEX IF NOT EXISTS "return_items_return_id_idx" ON "return_items"("return_id");
CREATE INDEX IF NOT EXISTS "return_items_order_item_id_idx" ON "return_items"("order_item_id");
CREATE INDEX IF NOT EXISTS "invoices_order_id_idx" ON "invoices"("order_id");
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices"("status");
CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- ─── FOREIGN KEYS ────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- RESTRICT (NOT CASCADE): redemption rows are financial audit data (anti-farming +
-- tax reconciliation). A customer with redemption history cannot be hard-deleted.
DO $$ BEGIN
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "shipments" ADD CONSTRAINT "shipments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "return_items" ADD CONSTRAINT "return_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── DEFERRED FKs (coupons now exists) ───────────────────

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "carts" ADD CONSTRAINT "carts_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
