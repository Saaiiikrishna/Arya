-- Commerce inventory & procurement (Section 2.3): warehouses (+ gstin), stock_levels
-- (UNIQUE(sku_id, warehouse_id) — THE oversell guard, + version optimistic-lock col),
-- stock_movements, stock_reservations, suppliers, purchase_orders,
-- purchase_order_lines (+ lot_no, UNIQUE(po, sku, lot_no)).
-- Money is integer paise. UUID columns have no DB default.

-- ─── TABLES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "warehouses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state_code" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "gstin" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_levels" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "reorder_qty" INTEGER NOT NULL DEFAULT 0,
    "safety_stock" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_movements" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "reason" "StockMovementReason" NOT NULL DEFAULT 'MANUAL_ADJUST',
    "quantity" INTEGER NOT NULL,            -- signed on_hand delta (+in / -out)
    "reserved_delta" INTEGER NOT NULL DEFAULT 0, -- signed reserved delta (+ reserved increased / - reserved decreased)
    "balance_after" INTEGER,
    "reference_type" TEXT,
    "reference_id" UUID,
    "triggered_by" TEXT NOT NULL,
    "actor_role" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_reservations" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "cart_id" UUID,
    "sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "gstin" TEXT,
    "address_line1" TEXT,
    "city" TEXT,
    "state_code" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "lead_time_days" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expected_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "auto_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "lot_no" INTEGER NOT NULL DEFAULT 1,
    "ordered_qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" INTEGER NOT NULL,
    "tax_bps" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- ─── UNIQUE INDEXES ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_code_key" ON "warehouses"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_levels_sku_id_warehouse_id_key" ON "stock_levels"("sku_id", "warehouse_id");
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_code_key" ON "suppliers"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_po_number_key" ON "purchase_orders"("po_number");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_lines_purchase_order_id_sku_id_lot_no_key" ON "purchase_order_lines"("purchase_order_id", "sku_id", "lot_no");

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "warehouses_is_active_idx" ON "warehouses"("is_active");
CREATE INDEX IF NOT EXISTS "stock_levels_warehouse_id_idx" ON "stock_levels"("warehouse_id");
CREATE INDEX IF NOT EXISTS "stock_levels_sku_id_idx" ON "stock_levels"("sku_id");
CREATE INDEX IF NOT EXISTS "stock_movements_sku_id_warehouse_id_idx" ON "stock_movements"("sku_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");
CREATE INDEX IF NOT EXISTS "stock_movements_created_at_idx" ON "stock_movements"("created_at");
CREATE INDEX IF NOT EXISTS "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");
CREATE INDEX IF NOT EXISTS "stock_reservations_cart_id_idx" ON "stock_reservations"("cart_id");
CREATE INDEX IF NOT EXISTS "stock_reservations_sku_id_warehouse_id_idx" ON "stock_reservations"("sku_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "suppliers_status_idx" ON "suppliers"("status");
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_warehouse_id_idx" ON "purchase_orders"("warehouse_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx" ON "purchase_orders"("status");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_sku_id_idx" ON "purchase_order_lines"("sku_id");

-- ─── FOREIGN KEYS ────────────────────────────────────────
-- NOTE: stock_reservations.order_id → orders FK is deferred to the orders
-- migration (20260610000005), since orders does not exist yet at this point.
-- (Warehouse FKs are ON DELETE RESTRICT, NOT CASCADE: a warehouse holding stock or
--  movement history can never be hard-deleted — it is deactivated (is_active=false).
--  This protects the oversell-guard rows and the immutable stock_movements audit trail.)

DO $$ BEGIN
  ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
