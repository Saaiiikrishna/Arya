-- Migration: add_dept_roles_and_interviews
-- Adds department tracking, interview scheduling, and extends team change requests

-- New enums
CREATE TYPE "DepartmentRole" AS ENUM ('PRODUCT', 'OPERATIONS', 'RESOURCES', 'SALES_MARKETING', 'FOUNDING_OTHER');
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "InterviewDecision" AS ENUM ('SELECTED', 'REJECTED', 'WAITLISTED');

-- Extend TeamRequestType (PostgreSQL requires ADD VALUE for existing enum)
ALTER TYPE "TeamRequestType" ADD VALUE 'SEPARATION';
ALTER TYPE "TeamRequestType" ADD VALUE 'JOIN_EXISTING';
ALTER TYPE "TeamRequestType" ADD VALUE 'CREATE_NEW';

-- Add department tracking to applicants
ALTER TABLE "applicants" ADD COLUMN "department" "DepartmentRole";
ALTER TABLE "applicants" ADD COLUMN "is_available" BOOLEAN NOT NULL DEFAULT true;

-- Add lock flag to teams
ALTER TABLE "teams" ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false;

-- Add target_team_id to team_requests (for JOIN_EXISTING/SEPARATION flows)
ALTER TABLE "team_requests" ADD COLUMN "target_team_id" UUID;

ALTER TABLE "team_requests" ADD CONSTRAINT "team_requests_target_team_id_fkey"
    FOREIGN KEY ("target_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "team_requests_target_team_id_idx" ON "team_requests"("target_team_id");

-- Interview slots table
CREATE TABLE "interview_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interview_slots_batch_id_idx" ON "interview_slots"("batch_id");
CREATE INDEX "interview_slots_start_time_idx" ON "interview_slots"("start_time");

ALTER TABLE "interview_slots" ADD CONSTRAINT "interview_slots_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Interview bookings table
CREATE TABLE "interview_bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slot_id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "notes" TEXT,
    "score" INTEGER,
    "decision" "InterviewDecision",
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_bookings_pkey" PRIMARY KEY ("id")
);

-- Composite unique: one booking per applicant per slot (allows re-applying across batches)
CREATE UNIQUE INDEX "interview_bookings_applicant_id_slot_id_key" ON "interview_bookings"("applicant_id", "slot_id");
CREATE INDEX "interview_bookings_slot_id_idx" ON "interview_bookings"("slot_id");
CREATE INDEX "interview_bookings_status_idx" ON "interview_bookings"("status");

ALTER TABLE "interview_bookings" ADD CONSTRAINT "interview_bookings_slot_id_fkey"
    FOREIGN KEY ("slot_id") REFERENCES "interview_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_bookings" ADD CONSTRAINT "interview_bookings_applicant_id_fkey"
    FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Video submissions table
CREATE TABLE "video_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "applicant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "video_url_1" TEXT,
    "video_url_2" TEXT,
    "video_url_3" TEXT,
    "score" INTEGER,
    "review_notes" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" UUID,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_submissions_pkey" PRIMARY KEY ("id")
);

-- Composite unique: one submission per applicant per batch (allows re-applying across batches)
CREATE UNIQUE INDEX "video_submissions_applicant_id_batch_id_key" ON "video_submissions"("applicant_id", "batch_id");
CREATE INDEX "video_submissions_batch_id_idx" ON "video_submissions"("batch_id");

ALTER TABLE "video_submissions" ADD CONSTRAINT "video_submissions_applicant_id_fkey"
    FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_submissions" ADD CONSTRAINT "video_submissions_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
