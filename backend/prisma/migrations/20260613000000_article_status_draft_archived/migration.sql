-- Real DRAFT + ARCHIVED article states (Section 2.7 articles vertical).
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so each value
-- is added on its own statement with no wrapping BEGIN/COMMIT. IF NOT EXISTS
-- makes the migration idempotent / re-runnable.
ALTER TYPE "ArticleStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "ArticleStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
