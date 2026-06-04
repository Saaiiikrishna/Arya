-- Seed commerce defaults (Section 3, step 10). Idempotent: every INSERT uses
-- ON CONFLICT DO NOTHING so re-running is a no-op. UUIDs are literal app-side
-- values (no pgcrypto / gen_random_uuid). Seeds:
--   * one default warehouse (is_default=true); state_code + gstin are left NULL
--     here and populated by the settings/admin flow from SiteSettings at runtime.
--   * common GST tax classes (0 / 5 / 12 / 18 / 28%), split as CGST=SGST=half.
--   * the current FY invoice_sequences row (FY 2026-27).
--   * number_sequences rows for ORDER / PO / RMA.
--
-- FY-ROLLOVER NOTE: this seed covers only the current FY. The store-invoice-generation
-- job creates each new FY's invoice_sequences row atomically inside the numbering
-- transaction via `INSERT ... ON CONFLICT DO NOTHING` followed by the `FOR UPDATE`
-- bump, so the first invoice of a new FY cannot race two replicas into resetting
-- last_value. Do NOT pre-seed future FY rows here.

-- ─── DEFAULT WAREHOUSE ───────────────────────────────────
-- state_code + gstin are intentionally left NULL here and populated by the settings/admin
-- flow from SiteSettings at runtime.
-- INVARIANT (service-enforced): the warehouse-allocation service MUST NOT select a
-- warehouse with a NULL state_code as the fulfilling warehouse — doing so would freeze a
-- NULL seller_gstin_snapshot / seller_state_code onto the order and produce an invalid GST
-- invoice. Allocation must skip (or 422-block checkout on) warehouses whose state_code IS NULL
-- until an admin configures the seller GST identity.
INSERT INTO "warehouses" ("id", "code", "name", "country", "priority", "is_active", "is_default", "created_at", "updated_at")
VALUES ('9af3d64b-39e0-4c6e-8ad9-5ec88c894992', 'WH-DEFAULT', 'Default Warehouse', 'IN', 0, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ─── COMMON GST TAX CLASSES ──────────────────────────────
-- Intra-state CGST=SGST=half of total; igst_bps holds the full rate (applied inter-state).
INSERT INTO "tax_classes" ("id", "name", "type", "cgst_bps", "sgst_bps", "igst_bps", "is_active", "created_at", "updated_at") VALUES
  ('5a2c741a-f186-44d0-82b4-7da6db3bd7fb', 'GST 0%',  'GST',    0,    0,    0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('8b9039a8-1417-4045-9f0a-db81c431a235', 'GST 5%',  'GST',  250,  250,  500, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('05a30206-2c42-44fa-ae25-5990065b2aed', 'GST 12%', 'GST',  600,  600, 1200, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('bbf02fdd-7db7-4a19-8494-7adc24d50ee0', 'GST 18%', 'GST',  900,  900, 1800, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('470c5987-9864-421d-ad46-3be8e9632ab2', 'GST 28%', 'GST', 1400, 1400, 2800, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- ─── CURRENT FY INVOICE SEQUENCE (2026-27) ───────────────
INSERT INTO "invoice_sequences" ("financial_year", "last_value", "prefix", "updated_at")
VALUES ('2026-27', 0, 'ARYA', CURRENT_TIMESTAMP)
ON CONFLICT ("financial_year") DO NOTHING;

-- ─── HUMAN-REF NUMBER SEQUENCES ──────────────────────────
INSERT INTO "number_sequences" ("scope", "last_value", "prefix", "updated_at") VALUES
  ('ORDER', 0, 'ARO', CURRENT_TIMESTAMP),
  ('PO',    0, 'PO',  CURRENT_TIMESTAMP),
  ('RMA',   0, 'RMA', CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;
