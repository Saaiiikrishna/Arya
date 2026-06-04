-- Convert articles.reviewed_by_id from TEXT to UUID (Section 2.7 articles vertical).
-- Every other UUID FK on `articles` (id, author_id) is UUID; reviewed_by_id stores
-- an admin UUID but was created as TEXT. Align it to the project UUID convention so
-- Postgres enforces UUID format on the column.
--
-- Idempotent / re-runnable: the ALTER only fires when the column is still 'text'.
-- The USING cast handles existing rows (any stored value is already a UUID string,
-- written from a verified admin id; NULLs cast cleanly to NULL).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'articles'
      AND column_name = 'reviewed_by_id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE "articles"
      ALTER COLUMN "reviewed_by_id" TYPE UUID USING "reviewed_by_id"::UUID;
  END IF;
END $$;
