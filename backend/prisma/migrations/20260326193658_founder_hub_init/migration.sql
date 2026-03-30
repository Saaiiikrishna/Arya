-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('UNDER_DEVELOPMENT', 'TESTING', 'LAUNCHED', 'TRAINING');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('ON_TRACK', 'DELAYED', 'TRAINING');

-- CreateEnum
CREATE TYPE "MilestoneType" AS ENUM ('COMMON', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('DISBURSEMENT', 'UTILIZATION');

-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "availability" TEXT,
ADD COLUMN     "avg_response_time_ms" INTEGER,
ADD COLUMN     "is_online" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_active_at" TIMESTAMP(3),
ADD COLUMN     "role" TEXT,
ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "project_name" TEXT NOT NULL,
    "target_market" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimated_funds" DOUBLE PRECISION NOT NULL,
    "funded_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ProjectStatus" NOT NULL DEFAULT 'UNDER_DEVELOPMENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'ON_TRACK',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "sprint_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "type" "MilestoneType" NOT NULL DEFAULT 'CUSTOM',
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "LedgerTransactionType" NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_team_id_key" ON "projects"("team_id");

-- CreateIndex
CREATE INDEX "sprints_team_id_idx" ON "sprints"("team_id");

-- CreateIndex
CREATE INDEX "milestones_sprint_id_idx" ON "milestones"("sprint_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_project_id_idx" ON "ledger_transactions"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
