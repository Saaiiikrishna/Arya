-- Commerce orders (Section 2.4): orders (+ guest_access_token_hash unique,
-- seller_gstin_snapshot, refunded_total), order_items (+ per-line cgst/sgst/igst
-- bps + amount snapshots — the SINGLE SOURCE OF TRUTH for invoices), order_events,
-- number_sequences (gapless ORDER/PO/RMA counters).
-- Adds the deferred stock_reservations.order_id → orders FK.
-- orders.coupon_id → coupons FK is deferred to 20260610000006.
-- Money is integer paise. UUID columns have no DB default.

-- ─── TABLES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "guest_access_token_hash" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "items_subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount_total" INTEGER NOT NULL DEFAULT 0,
    "cgst_total" INTEGER NOT NULL DEFAULT 0,
    "sgst_total" INTEGER NOT NULL DEFAULT 0,
    "igst_total" INTEGER NOT NULL DEFAULT 0,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "shipping_total" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL DEFAULT 0,
    "refunded_total" INTEGER NOT NULL DEFAULT 0,
    "coupon_id" UUID,
    "coupon_code_snapshot" TEXT,
    "billing_address" JSONB NOT NULL,
    "shipping_address" JSONB NOT NULL,
    "place_of_supply_state" TEXT,
    "seller_state_code" TEXT,
    "seller_gstin_snapshot" TEXT,
    "is_inter_state" BOOLEAN NOT NULL DEFAULT false,
    "fulfilled_from_warehouse_id" UUID,
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "placed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sku_id" UUID,
    "sku_code_snapshot" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "variant_snapshot" JSONB,
    "hsn_code_snapshot" TEXT,
    "gst_bps_snapshot" INTEGER NOT NULL DEFAULT 0,
    "cgst_bps_snapshot" INTEGER NOT NULL DEFAULT 0,
    "sgst_bps_snapshot" INTEGER NOT NULL DEFAULT 0,
    "igst_bps_snapshot" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "line_subtotal" INTEGER NOT NULL,
    "line_discount" INTEGER NOT NULL DEFAULT 0,
    "taxable_value" INTEGER NOT NULL,
    "cgst_amount" INTEGER NOT NULL DEFAULT 0,
    "sgst_amount" INTEGER NOT NULL DEFAULT 0,
    "igst_amount" INTEGER NOT NULL DEFAULT 0,
    "line_total" INTEGER NOT NULL,
    "warehouse_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "OrderEventType" NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "note" TEXT,
    "triggered_by" TEXT,
    "actor_role" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- Generic gapless counter for ORDER / PO / RMA human refs (PK = scope).
CREATE TABLE IF NOT EXISTS "number_sequences" (
    "scope" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("scope")
);

-- ─── UNIQUE INDEXES ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "orders_order_number_key" ON "orders"("order_number");
CREATE UNIQUE INDEX IF NOT EXISTS "orders_guest_access_token_hash_key" ON "orders"("guest_access_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "orders_razorpay_order_id_key" ON "orders"("razorpay_order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "orders_razorpay_payment_id_key" ON "orders"("razorpay_payment_id");

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");
CREATE INDEX IF NOT EXISTS "orders_payment_status_idx" ON "orders"("payment_status");
CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders"("created_at");
CREATE INDEX IF NOT EXISTS "orders_fulfilled_from_warehouse_id_idx" ON "orders"("fulfilled_from_warehouse_id");
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "order_items_sku_id_idx" ON "order_items"("sku_id");
CREATE INDEX IF NOT EXISTS "order_events_order_id_idx" ON "order_events"("order_id");
CREATE INDEX IF NOT EXISTS "order_events_type_idx" ON "order_events"("type");
CREATE INDEX IF NOT EXISTS "order_events_created_at_idx" ON "order_events"("created_at");

-- ─── FOREIGN KEYS ────────────────────────────────────────
-- orders.coupon_id → coupons deferred to 20260610000006 (coupons not yet created).

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- orders.fulfilled_from_warehouse_id → warehouses (created in 20260610000003).
-- SET NULL (NOT CASCADE): an order survives warehouse deletion; seller_gstin_snapshot /
-- seller_state_code preserve the frozen-at-order-time invoice identity so GST history
-- is never lost. (Warehouses are normally deactivated, not deleted — see migration 003.)
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilled_from_warehouse_id_fkey" FOREIGN KEY ("fulfilled_from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Deferred FK from the inventory migration: stock_reservations.order_id → orders.
DO $$ BEGIN
  ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
