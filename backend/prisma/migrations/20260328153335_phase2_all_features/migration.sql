-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('IDEA_BASED', 'BUILDER_POOL');

-- CreateEnum
CREATE TYPE "IdeaCategory" AS ENUM ('FINTECH', 'HEALTHTECH', 'EDTECH', 'ECOMMERCE', 'SAAS', 'SOCIAL', 'AI_ML', 'BLOCKCHAIN', 'SUSTAINABILITY', 'LOGISTICS', 'MEDIA', 'GAMING', 'OTHER');

-- CreateEnum
CREATE TYPE "CommitmentLevel" AS ENUM ('FULL_TIME', 'PART_TIME', 'WEEKENDS_ONLY', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DonationType" AS ENUM ('ONE_TIME', 'RECURRING');

-- AlterEnum
ALTER TYPE "ApplicantStatus" ADD VALUE 'TRAINING';

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "avatar_url" TEXT;

-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "heresy" TEXT,
ADD COLUMN     "obsession" TEXT,
ADD COLUMN     "scar_tissue" TEXT,
ADD COLUMN     "vocation" TEXT;

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "pledge_amount" DOUBLE PRECISION NOT NULL DEFAULT 10000.0;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "idea_category" "IdeaCategory",
ADD COLUMN     "match_score" DOUBLE PRECISION,
ADD COLUMN     "team_type" "TeamType" NOT NULL DEFAULT 'BUILDER_POOL';

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "razorpay_signature" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching_profiles" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "idea_category" "IdeaCategory",
    "has_idea" BOOLEAN NOT NULL DEFAULT false,
    "idea_summary" TEXT,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "commitment_level" "CommitmentLevel" NOT NULL DEFAULT 'FLEXIBLE',
    "hours_per_day" INTEGER,
    "personality_scores" JSONB,
    "experience_years" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matching_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investors" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "firm" TEXT,
    "bio" TEXT,
    "linkedin_url" TEXT,
    "interests" JSONB,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "avatar_url" TEXT,
    "password_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "startup_showcases" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "pitch_summary" TEXT NOT NULL,
    "mvp_demo_url" TEXT,
    "metrics" JSONB,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "startup_showcases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_requests" (
    "id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "showcase_id" UUID NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'REQUESTED',
    "message" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" UUID NOT NULL,
    "donor_name" TEXT NOT NULL,
    "donor_email" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "type" "DonationType" NOT NULL DEFAULT 'ONE_TIME',
    "message" TEXT,
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_modules" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "duration_min" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_assignments" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" UUID NOT NULL,
    "team_id" UUID,
    "name" TEXT NOT NULL,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_announcement" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_order_id_key" ON "payments"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpay_payment_id_key" ON "payments"("razorpay_payment_id");

-- CreateIndex
CREATE INDEX "payments_applicant_id_idx" ON "payments"("applicant_id");

-- CreateIndex
CREATE UNIQUE INDEX "matching_profiles_applicant_id_key" ON "matching_profiles"("applicant_id");

-- CreateIndex
CREATE INDEX "matching_profiles_idea_category_idx" ON "matching_profiles"("idea_category");

-- CreateIndex
CREATE INDEX "matching_profiles_commitment_level_idx" ON "matching_profiles"("commitment_level");

-- CreateIndex
CREATE INDEX "matching_profiles_has_idea_idx" ON "matching_profiles"("has_idea");

-- CreateIndex
CREATE UNIQUE INDEX "investors_email_key" ON "investors"("email");

-- CreateIndex
CREATE UNIQUE INDEX "startup_showcases_team_id_key" ON "startup_showcases"("team_id");

-- CreateIndex
CREATE INDEX "meeting_requests_investor_id_idx" ON "meeting_requests"("investor_id");

-- CreateIndex
CREATE INDEX "meeting_requests_showcase_id_idx" ON "meeting_requests"("showcase_id");

-- CreateIndex
CREATE UNIQUE INDEX "donations_razorpay_order_id_key" ON "donations"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "donations_razorpay_payment_id_key" ON "donations"("razorpay_payment_id");

-- CreateIndex
CREATE INDEX "donations_donor_email_idx" ON "donations"("donor_email");

-- CreateIndex
CREATE INDEX "donations_status_idx" ON "donations"("status");

-- CreateIndex
CREATE INDEX "training_assignments_applicant_id_idx" ON "training_assignments"("applicant_id");

-- CreateIndex
CREATE INDEX "training_assignments_module_id_idx" ON "training_assignments"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_assignments_applicant_id_module_id_key" ON "training_assignments"("applicant_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_team_id_key" ON "chat_rooms"("team_id");

-- CreateIndex
CREATE INDEX "chat_messages_room_id_idx" ON "chat_messages"("room_id");

-- CreateIndex
CREATE INDEX "chat_messages_sent_at_idx" ON "chat_messages"("sent_at");

-- CreateIndex
CREATE INDEX "teams_team_type_idx" ON "teams"("team_type");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_profiles" ADD CONSTRAINT "matching_profiles_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_showcase_id_fkey" FOREIGN KEY ("showcase_id") REFERENCES "startup_showcases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "training_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
