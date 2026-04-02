-- AlterTable
ALTER TABLE "batch_instructions" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "explanation" TEXT;

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "name" TEXT,
ADD COLUMN     "nickname" TEXT;

-- AlterTable
ALTER TABLE "leader_elections" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "instructions" TEXT;

-- AlterTable
ALTER TABLE "nominations" ADD COLUMN     "is_self_nomination" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "election_questions" (
    "id" UUID NOT NULL,
    "election_id" UUID,
    "label" TEXT NOT NULL,
    "help_text" TEXT,
    "type" "QuestionType" NOT NULL DEFAULT 'TEXTAREA',
    "options" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "election_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nomination_answers" (
    "id" UUID NOT NULL,
    "nomination_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "answered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nomination_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "batch_id" UUID,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deadline" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "election_questions_election_id_idx" ON "election_questions"("election_id");

-- CreateIndex
CREATE INDEX "election_questions_is_template_idx" ON "election_questions"("is_template");

-- CreateIndex
CREATE INDEX "nomination_answers_nomination_id_idx" ON "nomination_answers"("nomination_id");

-- CreateIndex
CREATE INDEX "nomination_answers_question_id_idx" ON "nomination_answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "nomination_answers_nomination_id_question_id_key" ON "nomination_answers"("nomination_id", "question_id");

-- CreateIndex
CREATE INDEX "announcements_batch_id_idx" ON "announcements"("batch_id");

-- CreateIndex
CREATE INDEX "announcements_is_active_idx" ON "announcements"("is_active");

-- AddForeignKey
ALTER TABLE "election_questions" ADD CONSTRAINT "election_questions_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "leader_elections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomination_answers" ADD CONSTRAINT "nomination_answers_nomination_id_fkey" FOREIGN KEY ("nomination_id") REFERENCES "nominations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomination_answers" ADD CONSTRAINT "nomination_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "election_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
