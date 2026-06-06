-- Restore tables/columns that exist in schema.prisma but were never migrated
-- (added via `prisma db push` during dev, so present locally but ABSENT in
-- production → every mentor/cofounder/sprint-blocker/check-in/resource-request/
-- documentary call threw a Prisma "table does not exist" error in prod).
--
-- This migration is purely ADDITIVE + idempotent. It deliberately EXCLUDES the
-- destructive drift the diff also reports (dropping the FTS `search_vector`
-- columns + GIN indexes, and the legacy id/updated_at DEFAULTs) — those are
-- intentional schema-vs-migration divergences that must be preserved.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BlockerSeverity') THEN
    CREATE TYPE "BlockerSeverity" AS ENUM ('HIGH', 'MED', 'LOW');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResourceRequestStatus') THEN
    CREATE TYPE "ResourceRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResourceType') THEN
    CREATE TYPE "ResourceType" AS ENUM ('INFRA', 'TOOLS', 'SPACE', 'EXPERTS', 'OTHER');
  END IF;
END $$;

-- ── team_requests: mentor-approval columns (gate the change-request workflow) ─
ALTER TABLE "team_requests" ADD COLUMN IF NOT EXISTS "mentor_reviewed_at" TIMESTAMP(3);
ALTER TABLE "team_requests" ADD COLUMN IF NOT EXISTS "mentor_reviewed_by_id" UUID;
ALTER TABLE "team_requests" ADD COLUMN IF NOT EXISTS "mentor_status" "TeamRequestStatus";

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "mentors" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "expertise" TEXT[],
  "bio" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "avatar_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mentors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mentor_assignments" (
  "id" UUID NOT NULL,
  "mentor_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "mentor_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cofounders" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "bio" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "avatar_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cofounders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cofounder_assignments" (
  "id" UUID NOT NULL,
  "cofounder_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "cofounder_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_reports" (
  "id" UUID NOT NULL,
  "cofounder_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "week" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "blockers" TEXT,
  "next_steps" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "resource_requests" (
  "id" UUID NOT NULL,
  "cofounder_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "type" "ResourceType" NOT NULL DEFAULT 'OTHER',
  "description" TEXT NOT NULL,
  "status" "ResourceRequestStatus" NOT NULL DEFAULT 'PENDING',
  "fulfilled_at" TIMESTAMP(3),
  "fulfilled_by" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "resource_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "blocker_logs" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "week" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "BlockerSeverity" NOT NULL DEFAULT 'MED',
  "is_resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "blocker_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_checkins" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "week" INTEGER NOT NULL,
  "progress_summary" TEXT NOT NULL,
  "cofounder_verified" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "verified_by_id" UUID,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "weekly_checkins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "documentary_clips" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "week" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "video_url" TEXT NOT NULL,
  "thumbnail_url" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "published_at" TIMESTAMP(3),
  "uploaded_by_id" UUID NOT NULL,
  "uploaded_by_role" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "documentary_clips_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "mentors_email_key" ON "mentors"("email");
CREATE INDEX IF NOT EXISTS "mentor_assignments_mentor_id_idx" ON "mentor_assignments"("mentor_id");
CREATE INDEX IF NOT EXISTS "mentor_assignments_team_id_idx" ON "mentor_assignments"("team_id");
CREATE INDEX IF NOT EXISTS "mentor_assignments_batch_id_idx" ON "mentor_assignments"("batch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mentor_assignments_mentor_id_team_id_key" ON "mentor_assignments"("mentor_id", "team_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cofounders_email_key" ON "cofounders"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "cofounder_assignments_team_id_key" ON "cofounder_assignments"("team_id");
CREATE INDEX IF NOT EXISTS "cofounder_assignments_cofounder_id_idx" ON "cofounder_assignments"("cofounder_id");
CREATE INDEX IF NOT EXISTS "cofounder_assignments_batch_id_idx" ON "cofounder_assignments"("batch_id");
CREATE INDEX IF NOT EXISTS "weekly_reports_team_id_idx" ON "weekly_reports"("team_id");
CREATE INDEX IF NOT EXISTS "weekly_reports_cofounder_id_idx" ON "weekly_reports"("cofounder_id");
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_reports_cofounder_id_team_id_week_key" ON "weekly_reports"("cofounder_id", "team_id", "week");
CREATE INDEX IF NOT EXISTS "resource_requests_team_id_idx" ON "resource_requests"("team_id");
CREATE INDEX IF NOT EXISTS "resource_requests_cofounder_id_idx" ON "resource_requests"("cofounder_id");
CREATE INDEX IF NOT EXISTS "resource_requests_status_idx" ON "resource_requests"("status");
CREATE INDEX IF NOT EXISTS "blocker_logs_team_id_idx" ON "blocker_logs"("team_id");
CREATE INDEX IF NOT EXISTS "blocker_logs_is_resolved_idx" ON "blocker_logs"("is_resolved");
CREATE INDEX IF NOT EXISTS "weekly_checkins_team_id_idx" ON "weekly_checkins"("team_id");
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_checkins_team_id_week_key" ON "weekly_checkins"("team_id", "week");
CREATE INDEX IF NOT EXISTS "documentary_clips_team_id_is_published_idx" ON "documentary_clips"("team_id", "is_published");
CREATE INDEX IF NOT EXISTS "documentary_clips_team_id_week_idx" ON "documentary_clips"("team_id", "week");

-- ── Foreign keys (guarded for idempotency) ──────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mentor_assignments_mentor_id_fkey') THEN
    ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mentor_assignments_team_id_fkey') THEN
    ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mentor_assignments_batch_id_fkey') THEN
    ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cofounder_assignments_cofounder_id_fkey') THEN
    ALTER TABLE "cofounder_assignments" ADD CONSTRAINT "cofounder_assignments_cofounder_id_fkey" FOREIGN KEY ("cofounder_id") REFERENCES "cofounders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cofounder_assignments_team_id_fkey') THEN
    ALTER TABLE "cofounder_assignments" ADD CONSTRAINT "cofounder_assignments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cofounder_assignments_batch_id_fkey') THEN
    ALTER TABLE "cofounder_assignments" ADD CONSTRAINT "cofounder_assignments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weekly_reports_team_id_fkey') THEN
    ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_requests_team_id_fkey') THEN
    ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocker_logs_team_id_fkey') THEN
    ALTER TABLE "blocker_logs" ADD CONSTRAINT "blocker_logs_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weekly_checkins_team_id_fkey') THEN
    ALTER TABLE "weekly_checkins" ADD CONSTRAINT "weekly_checkins_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentary_clips_team_id_fkey') THEN
    ALTER TABLE "documentary_clips" ADD CONSTRAINT "documentary_clips_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
