-- Commerce customers & cart (Section 2.4): customers, addresses, carts
-- (+ session_token_hash unique), cart_items. Includes the SQL-only PARTIAL UNIQUE
-- index for REGISTERED-customer email (Prisma cannot express it — expected migrate-diff
-- delta), and the customers.applicant_id → applicants FK (ON DELETE SET NULL).
-- carts.coupon_id FK is deferred to the coupons migration (20260610000006).

-- ─── TABLES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "customers" (
    "id" UUID NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'GUEST',
    "email" TEXT,
    "phone" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "password_hash" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "applicant_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'SHIPPING',
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "carts" (
    "id" UUID NOT NULL,
    "customer_id" UUID,
    "session_token_hash" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "coupon_id" UUID,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_snapshot" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- ─── UNIQUE INDEXES ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "customers_applicant_id_key" ON "customers"("applicant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "carts_session_token_hash_key" ON "carts"("session_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_id_sku_id_key" ON "cart_items"("cart_id", "sku_id");

-- Partial unique index: REGISTERED customers must have a unique email; guests
-- (type='GUEST') may share NULL email. Prisma can't model partial uniques, so this
-- is a deliberate SQL-only delta (do NOT "fix" it away on migrate diff).
CREATE UNIQUE INDEX IF NOT EXISTS "customers_registered_email_key"
  ON "customers" ("email") WHERE "type" = 'REGISTERED' AND "email" IS NOT NULL;

-- ─── SECONDARY INDEXES ───────────────────────────────────

CREATE INDEX IF NOT EXISTS "customers_email_idx" ON "customers"("email");
CREATE INDEX IF NOT EXISTS "customers_phone_idx" ON "customers"("phone");
CREATE INDEX IF NOT EXISTS "customers_applicant_id_idx" ON "customers"("applicant_id");
CREATE INDEX IF NOT EXISTS "addresses_customer_id_type_idx" ON "addresses"("customer_id", "type");
CREATE INDEX IF NOT EXISTS "carts_customer_id_status_idx" ON "carts"("customer_id", "status");
CREATE INDEX IF NOT EXISTS "carts_status_expires_at_idx" ON "carts"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "cart_items_cart_id_idx" ON "cart_items"("cart_id");
CREATE INDEX IF NOT EXISTS "cart_items_sku_id_idx" ON "cart_items"("sku_id");

-- ─── FOREIGN KEYS ────────────────────────────────────────
-- carts.coupon_id → coupons deferred to 20260610000006 (coupons not yet created).

DO $$ BEGIN
  ALTER TABLE "customers" ADD CONSTRAINT "customers_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
