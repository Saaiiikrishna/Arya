-- Dual-approval gate for the 1000-day equity handover: one ADMIN row + one
-- COFOUNDER row must exist for a company before the platform's 51% can transfer.
CREATE TABLE IF NOT EXISTS "handover_approvals" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "approver_id" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "handover_approvals_pkey" PRIMARY KEY ("id")
);

-- One approval per (company, role) — re-approving updates the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS "handover_approvals_company_id_role_key"
  ON "handover_approvals" ("company_id", "role");
CREATE INDEX IF NOT EXISTS "handover_approvals_company_id_idx"
  ON "handover_approvals" ("company_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'handover_approvals_company_id_fkey'
  ) THEN
    ALTER TABLE "handover_approvals"
      ADD CONSTRAINT "handover_approvals_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "company_entities"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
