-- RFC 9700 refresh-token rotation: family tracking for reuse/replay detection.
-- Every token in a rotation chain shares one family_id; presenting an already
-- revoked token from a family lets the auth service revoke the whole family.

-- 1) Add nullable, backfill existing rows (each existing token = its own family),
--    then enforce NOT NULL. Avoids a default and is safe to re-run.
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" UUID;
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

-- 2) Index for the family-wide revocation lookup.
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_id_idx"
  ON "refresh_tokens" ("family_id");
