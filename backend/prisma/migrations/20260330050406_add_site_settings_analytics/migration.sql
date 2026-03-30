-- CreateTable
CREATE TABLE "site_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "page_views" (
    "id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "ip" TEXT,
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
    "duration" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_page_stats" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "unique_ips" INTEGER NOT NULL DEFAULT 0,
    "avg_duration" DOUBLE PRECISION,

    CONSTRAINT "daily_page_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_views_timestamp_idx" ON "page_views"("timestamp");

-- CreateIndex
CREATE INDEX "page_views_session_id_idx" ON "page_views"("session_id");

-- CreateIndex
CREATE INDEX "page_views_path_idx" ON "page_views"("path");

-- CreateIndex
CREATE INDEX "page_views_applicant_id_idx" ON "page_views"("applicant_id");

-- CreateIndex
CREATE INDEX "daily_page_stats_date_idx" ON "daily_page_stats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_page_stats_date_path_key" ON "daily_page_stats"("date", "path");
