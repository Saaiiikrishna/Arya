-- Investor pitch events + interests + funding decisions.
-- These models (PitchEvent / InvestorInterest / FundingDecision) existed in
-- schema.prisma but no migration ever created their tables, so every call to
-- GET /api/admin/pitch/events failed in production with a Prisma "table does not
-- exist" error. This creates them to match the schema. Idempotent throughout.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PitchEventStatus') THEN
    CREATE TYPE "PitchEventStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvestorInterestStatus') THEN
    CREATE TYPE "InvestorInterestStatus" AS ENUM ('PENDING', 'SHORTLISTED', 'PASSED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FundingOutcome') THEN
    CREATE TYPE "FundingOutcome" AS ENUM ('FUNDED', 'PASSED');
  END IF;
END $$;

-- ── pitch_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pitch_events" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "venue" TEXT,
  "notes" TEXT,
  "status" "PitchEventStatus" NOT NULL DEFAULT 'SCHEDULED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pitch_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pitch_events_team_id_idx" ON "pitch_events" ("team_id");
CREATE INDEX IF NOT EXISTS "pitch_events_status_idx" ON "pitch_events" ("status");

-- ── investor_interests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "investor_interests" (
  "id" UUID NOT NULL,
  "pitch_event_id" UUID NOT NULL,
  "investor_id" UUID NOT NULL,
  "status" "InvestorInterestStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "investor_interests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "investor_interests_pitch_event_id_investor_id_key"
  ON "investor_interests" ("pitch_event_id", "investor_id");
CREATE INDEX IF NOT EXISTS "investor_interests_pitch_event_id_idx" ON "investor_interests" ("pitch_event_id");
CREATE INDEX IF NOT EXISTS "investor_interests_investor_id_idx" ON "investor_interests" ("investor_id");

-- ── funding_decisions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "funding_decisions" (
  "id" UUID NOT NULL,
  "pitch_event_id" UUID NOT NULL,
  "investor_id" UUID NOT NULL,
  "outcome" "FundingOutcome" NOT NULL,
  "amount" DOUBLE PRECISION,
  "terms" JSONB,
  "notes" TEXT,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "funding_decisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "funding_decisions_pitch_event_id_investor_id_key"
  ON "funding_decisions" ("pitch_event_id", "investor_id");
CREATE INDEX IF NOT EXISTS "funding_decisions_pitch_event_id_idx" ON "funding_decisions" ("pitch_event_id");
CREATE INDEX IF NOT EXISTS "funding_decisions_investor_id_idx" ON "funding_decisions" ("investor_id");

-- ── Foreign keys (guarded so re-runs don't error) ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pitch_events_team_id_fkey') THEN
    ALTER TABLE "pitch_events" ADD CONSTRAINT "pitch_events_team_id_fkey"
      FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investor_interests_pitch_event_id_fkey') THEN
    ALTER TABLE "investor_interests" ADD CONSTRAINT "investor_interests_pitch_event_id_fkey"
      FOREIGN KEY ("pitch_event_id") REFERENCES "pitch_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'funding_decisions_pitch_event_id_fkey') THEN
    ALTER TABLE "funding_decisions" ADD CONSTRAINT "funding_decisions_pitch_event_id_fkey"
      FOREIGN KEY ("pitch_event_id") REFERENCES "pitch_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
