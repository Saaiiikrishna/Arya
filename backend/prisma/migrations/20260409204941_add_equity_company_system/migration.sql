-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('FORMATION', 'INCORPORATED', 'ACTIVE', 'SUSPENDED', 'HANDED_OVER', 'DISSOLVED');

-- CreateEnum
CREATE TYPE "EquityEventType" AS ENUM ('GRANT', 'VEST', 'DILUTE', 'TRANSFER', 'HANDOVER', 'BUYOUT');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'PENDING_SIGNATURE', 'ACTIVE', 'AMENDED', 'EXPIRED', 'TERMINATED');

-- CreateTable
CREATE TABLE "company_entities" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "registration_number" TEXT,
    "incorporation_date" TIMESTAMP(3),
    "status" "CompanyStatus" NOT NULL DEFAULT 'FORMATION',
    "timer_start_date" TIMESTAMP(3),
    "timer_end_date" TIMESTAMP(3),
    "days_elapsed" INTEGER NOT NULL DEFAULT 0,
    "handover_date" TIMESTAMP(3),
    "platform_equity_pct" DOUBLE PRECISION NOT NULL DEFAULT 51.0,
    "founders_equity_pct" DOUBLE PRECISION NOT NULL DEFAULT 49.0,
    "sector" TEXT,
    "description" TEXT,
    "registered_address" TEXT,
    "gstin" TEXT,
    "pan_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_holders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "applicant_id" UUID,
    "holder_name" TEXT NOT NULL,
    "holder_type" TEXT NOT NULL,
    "equity_pct" DOUBLE PRECISION NOT NULL,
    "vested_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vesting_schedule" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_agreements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agreement_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "terms" JSONB,
    "equity_pct" DOUBLE PRECISION,
    "duration" INTEGER,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "platform_signed_at" TIMESTAMP(3),
    "platform_signed_by" TEXT,
    "founder_signed_at" TIMESTAMP(3),
    "founder_signed_by" UUID,
    "document_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "event_type" "EquityEventType" NOT NULL,
    "from_holder" TEXT,
    "to_holder" TEXT,
    "percentage_amount" DOUBLE PRECISION NOT NULL,
    "platform_equity_after" DOUBLE PRECISION,
    "founders_equity_after" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "triggered_by" TEXT,
    "day_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_entities_team_id_key" ON "company_entities"("team_id");

-- CreateIndex
CREATE INDEX "company_entities_status_idx" ON "company_entities"("status");

-- CreateIndex
CREATE INDEX "company_entities_timer_end_date_idx" ON "company_entities"("timer_end_date");

-- CreateIndex
CREATE INDEX "equity_holders_company_id_idx" ON "equity_holders"("company_id");

-- CreateIndex
CREATE INDEX "equity_holders_applicant_id_idx" ON "equity_holders"("applicant_id");

-- CreateIndex
CREATE UNIQUE INDEX "equity_holders_company_id_applicant_id_key" ON "equity_holders"("company_id", "applicant_id");

-- CreateIndex
CREATE INDEX "equity_agreements_company_id_idx" ON "equity_agreements"("company_id");

-- CreateIndex
CREATE INDEX "equity_agreements_status_idx" ON "equity_agreements"("status");

-- CreateIndex
CREATE INDEX "equity_events_company_id_idx" ON "equity_events"("company_id");

-- CreateIndex
CREATE INDEX "equity_events_event_type_idx" ON "equity_events"("event_type");

-- CreateIndex
CREATE INDEX "equity_events_created_at_idx" ON "equity_events"("created_at");

-- AddForeignKey
ALTER TABLE "company_entities" ADD CONSTRAINT "company_entities_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_holders" ADD CONSTRAINT "equity_holders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_holders" ADD CONSTRAINT "equity_holders_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_agreements" ADD CONSTRAINT "equity_agreements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_events" ADD CONSTRAINT "equity_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
