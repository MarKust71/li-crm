-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('UI', 'SYNC', 'NOTIFY', 'AUTH', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ActivitySource" NOT NULL,
    "level" "ActivityLevel" NOT NULL DEFAULT 'INFO',
    "action" TEXT NOT NULL,
    "contactId" TEXT,
    "summary" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_at_idx" ON "ActivityLog"("at");

-- CreateIndex
CREATE INDEX "ActivityLog_source_at_idx" ON "ActivityLog"("source", "at");

-- CreateIndex
CREATE INDEX "ActivityLog_contactId_at_idx" ON "ActivityLog"("contactId", "at");

