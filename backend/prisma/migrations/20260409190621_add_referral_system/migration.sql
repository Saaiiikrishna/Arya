/*
  Warnings:

  - You are about to drop the `page_views` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "referred_by_id" UUID;

-- DropTable
DROP TABLE "page_views";

-- CreateTable
CREATE TABLE "referral_profiles" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "referral_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "total_referrals" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "total_duration" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT,
    "city" TEXT,
    "region" TEXT,
    "user_agent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "device" TEXT,
    "screen_width" INTEGER,
    "screen_height" INTEGER,
    "language" TEXT,
    "applicant_id" UUID,
    "applicant_email" TEXT,
    "applicant_name" TEXT,
    "first_visit_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_visit_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_profiles_applicant_id_key" ON "referral_profiles"("applicant_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_profiles_referral_code_key" ON "referral_profiles"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "visitors_session_id_key" ON "visitors"("session_id");

-- CreateIndex
CREATE INDEX "visitors_ip_idx" ON "visitors"("ip");

-- CreateIndex
CREATE INDEX "visitors_last_visit_at_idx" ON "visitors"("last_visit_at");

-- CreateIndex
CREATE INDEX "visitors_applicant_id_idx" ON "visitors"("applicant_id");

-- CreateIndex
CREATE INDEX "applicants_referred_by_id_idx" ON "applicants"("referred_by_id");

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_profiles" ADD CONSTRAINT "referral_profiles_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
