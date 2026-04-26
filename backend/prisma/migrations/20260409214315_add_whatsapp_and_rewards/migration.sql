-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "whatsapp_phone" TEXT,
ADD COLUMN     "whatsapp_presence_checked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "badges" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "criteria" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_badges" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "badge_id" UUID NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applicant_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry_date" TIMESTAMP(3),
    "url" TEXT,
    "linkedin_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "badges_name_key" ON "badges"("name");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_badges_applicant_id_badge_id_key" ON "applicant_badges"("applicant_id", "badge_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_credential_id_key" ON "certificates"("credential_id");

-- CreateIndex
CREATE INDEX "certificates_applicant_id_idx" ON "certificates"("applicant_id");

-- AddForeignKey
ALTER TABLE "applicant_badges" ADD CONSTRAINT "applicant_badges_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_badges" ADD CONSTRAINT "applicant_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
