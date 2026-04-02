/*
  Warnings:

  - A unique constraint covering the columns `[leader_id]` on the table `teams` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ElectionStatus" AS ENUM ('NOMINATION', 'VOTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TeamRequestType" AS ENUM ('SWAP', 'RESOURCE', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "TeamRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "is_team_leader" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "leader_id" UUID;

-- CreateTable
CREATE TABLE "leader_elections" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "status" "ElectionStatus" NOT NULL DEFAULT 'NOMINATION',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "winner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leader_elections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nominations" (
    "id" UUID NOT NULL,
    "election_id" UUID NOT NULL,
    "nominee_id" UUID NOT NULL,
    "nominated_by_id" UUID,
    "reason" TEXT,
    "pitch" TEXT,
    "skills" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nominations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leader_votes" (
    "id" UUID NOT NULL,
    "election_id" UUID NOT NULL,
    "voter_id" UUID NOT NULL,
    "nominee_id" UUID NOT NULL,
    "cast_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leader_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_requests" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "type" "TeamRequestType" NOT NULL,
    "status" "TeamRequestStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leader_elections_team_id_idx" ON "leader_elections"("team_id");

-- CreateIndex
CREATE INDEX "leader_elections_status_idx" ON "leader_elections"("status");

-- CreateIndex
CREATE INDEX "nominations_election_id_idx" ON "nominations"("election_id");

-- CreateIndex
CREATE INDEX "nominations_nominee_id_idx" ON "nominations"("nominee_id");

-- CreateIndex
CREATE UNIQUE INDEX "nominations_election_id_nominee_id_key" ON "nominations"("election_id", "nominee_id");

-- CreateIndex
CREATE INDEX "leader_votes_election_id_idx" ON "leader_votes"("election_id");

-- CreateIndex
CREATE INDEX "leader_votes_nominee_id_idx" ON "leader_votes"("nominee_id");

-- CreateIndex
CREATE UNIQUE INDEX "leader_votes_election_id_voter_id_key" ON "leader_votes"("election_id", "voter_id");

-- CreateIndex
CREATE INDEX "team_requests_team_id_idx" ON "team_requests"("team_id");

-- CreateIndex
CREATE INDEX "team_requests_requester_id_idx" ON "team_requests"("requester_id");

-- CreateIndex
CREATE INDEX "team_requests_status_idx" ON "team_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "teams_leader_id_key" ON "teams"("leader_id");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leader_elections" ADD CONSTRAINT "leader_elections_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "leader_elections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leader_votes" ADD CONSTRAINT "leader_votes_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "leader_elections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_requests" ADD CONSTRAINT "team_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
