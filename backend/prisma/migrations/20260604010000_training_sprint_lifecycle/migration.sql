-- TRAINING pause metadata on teams (admin-set reason + timestamp).
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "training_reason" TEXT;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "training_started_at" TIMESTAMP(3);

-- Sprint sequencing + completion for the two-sprint (180-day) lifecycle.
ALTER TABLE "sprints" ADD COLUMN IF NOT EXISTS "sprint_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "sprints" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);

-- New SprintStatus value for completed sprints (the 1000-day timer gate keys
-- off two COMPLETED sprints). ADD VALUE IF NOT EXISTS is idempotent on PG 12+.
ALTER TYPE "SprintStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
