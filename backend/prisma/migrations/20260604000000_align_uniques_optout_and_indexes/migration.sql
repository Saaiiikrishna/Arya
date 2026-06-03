-- Align interview/video "one-per-applicant" uniques with the Prisma schema.
-- The live DB had NEITHER the single-column nor the composite unique on
-- applicant_id (only the PK), so the @unique invariant was unenforced. There
-- are currently 0 duplicate rows, so adding the unique index is safe. The
-- DROP ... IF EXISTS handles environments where a composite was created.
DROP INDEX IF EXISTS "interview_bookings_applicant_id_slot_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "interview_bookings_applicant_id_key" ON "interview_bookings"("applicant_id");

DROP INDEX IF EXISTS "video_submissions_applicant_id_batch_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "video_submissions_applicant_id_key" ON "video_submissions"("applicant_id");

-- Dedicated WhatsApp STOP opt-out flag, distinct from whatsapp_verified
-- (which is a verification gate and must not double as an opt-out signal).
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "whatsapp_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- Indexes for phone-based applicant lookups (STOP opt-out enforcement on the
-- send path + inbound webhook resolution), previously full-table scans.
CREATE INDEX IF NOT EXISTS "applicants_phone_idx" ON "applicants"("phone");
CREATE INDEX IF NOT EXISTS "applicants_whatsapp_phone_idx" ON "applicants"("whatsapp_phone");
