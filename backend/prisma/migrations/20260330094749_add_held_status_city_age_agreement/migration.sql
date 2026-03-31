-- AlterEnum
ALTER TYPE "ApplicantStatus" ADD VALUE 'HELD';

-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "agreement_accepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "city" TEXT;
