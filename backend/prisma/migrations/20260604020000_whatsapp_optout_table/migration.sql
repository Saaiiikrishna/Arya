-- Dedicated WhatsApp opt-out list keyed by normalized (digits-only) phone, so the
-- send-path opt-out check is an indexed PK lookup instead of a LIKE %x% table scan.
CREATE TABLE IF NOT EXISTS "whatsapp_opt_outs" (
  "phone" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_opt_outs_pkey" PRIMARY KEY ("phone")
);

-- Preserve any existing per-applicant opt-outs (normalized) before dropping the flag.
INSERT INTO "whatsapp_opt_outs" ("phone")
SELECT DISTINCT regexp_replace(COALESCE("phone", ''), '\D', '', 'g')
FROM "applicants"
WHERE "whatsapp_opt_out" = true
  AND regexp_replace(COALESCE("phone", ''), '\D', '', 'g') <> ''
ON CONFLICT ("phone") DO NOTHING;

INSERT INTO "whatsapp_opt_outs" ("phone")
SELECT DISTINCT regexp_replace(COALESCE("whatsapp_phone", ''), '\D', '', 'g')
FROM "applicants"
WHERE "whatsapp_opt_out" = true
  AND regexp_replace(COALESCE("whatsapp_phone", ''), '\D', '', 'g') <> ''
ON CONFLICT ("phone") DO NOTHING;

-- The per-applicant boolean is superseded by the table above.
ALTER TABLE "applicants" DROP COLUMN IF EXISTS "whatsapp_opt_out";
