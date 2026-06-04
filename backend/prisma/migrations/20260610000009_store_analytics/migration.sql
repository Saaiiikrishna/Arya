-- Store analytics rollup (Section 2.9): store_daily_stats. Nightly raw-SQL rollup
-- of orders/revenue/units/refunds/discounts/new-customers/visitors, idempotent
-- per IST day via UNIQUE(stat_date). Independent of other commerce tables.
-- Money is integer paise. UUID column has no DB default.

CREATE TABLE IF NOT EXISTS "store_daily_stats" (
    "id" UUID NOT NULL,
    "stat_date" DATE NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "paid_orders" INTEGER NOT NULL DEFAULT 0,
    "gross_revenue" INTEGER NOT NULL DEFAULT 0,
    "net_revenue" INTEGER NOT NULL DEFAULT 0,
    "units_sold" INTEGER NOT NULL DEFAULT 0,
    "refunds_total" INTEGER NOT NULL DEFAULT 0,
    "discount_total" INTEGER NOT NULL DEFAULT 0,
    "new_customers" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- DEFAULT CURRENT_TIMESTAMP so the nightly raw-SQL ($queryRaw) idempotent upsert,
    -- which does not go through Prisma's @updatedAt, never hits a NOT NULL violation
    -- on insert. Raw upserts should still set updated_at = CURRENT_TIMESTAMP on the
    -- ON CONFLICT DO UPDATE branch.
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_daily_stats_stat_date_key" ON "store_daily_stats"("stat_date");
