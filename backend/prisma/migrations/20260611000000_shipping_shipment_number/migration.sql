-- Shipping module (architecture 4.9): add the human-readable, gapless shipment
-- number to shipments and seed its NumberSequence scope.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT
-- EXISTS / INSERT ... ON CONFLICT DO NOTHING, so re-running on an already-migrated
-- DB is a no-op and the existing frozen commerce chain (20260610000001-10) is left
-- untouched. No pgcrypto.

-- ─── shipment_number column (nullable: pre-existing shipments have none) ──
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "shipment_number" TEXT;

-- Unique so the gapless counter never collides. NULLs are distinct in Postgres,
-- so legacy rows with a NULL number do not violate uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_shipment_number_key"
  ON "shipments"("shipment_number");

-- ─── orders.delivered_at (anchors the 7-day returns window) ──────────────
-- Stamped by the courier-delivery webhook when a shipment reaches DELIVERED.
-- Nullable; pre-delivery / legacy orders have NULL.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);

-- ─── NumberSequence scope for shipment numbers (AS-000001) ───────────────
-- number_sequences was created in 20260610000005; add the SHIPMENT scope. The
-- shipping service also self-seeds this row via INSERT ... ON CONFLICT DO NOTHING
-- before its first allocation, so this seed is belt-and-suspenders.
INSERT INTO "number_sequences" ("scope", "last_value", "prefix", "updated_at")
VALUES ('SHIPMENT', 0, 'AS', CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;
