-- orders.cart_id (checkout reuse correctness): the cart an order was minted from.
-- The previous checkout reuse query keyed only on (customerId, PENDING_PAYMENT,
-- grandTotal, age, razorpayOrderId not null), so two DISTINCT carts with the same
-- total within the reuse window collapsed onto the first pending order. Keying the
-- reuse on the cart fixes that: a different cart can never reuse another cart's
-- pending order.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so
-- re-running on an already-migrated DB is a no-op and the frozen commerce chain
-- (20260610000001-10, 20260611000000) is left untouched. No FK relation (the cart
-- row is marked CONVERTED, never deleted), no pgcrypto.

-- ─── cart_id column (nullable: pre-existing orders have none) ─────────────
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cart_id" UUID;

-- ─── index for the reuse-window lookup keyed on the cart ─────────────────
CREATE INDEX IF NOT EXISTS "orders_cart_id_idx" ON "orders"("cart_id");
