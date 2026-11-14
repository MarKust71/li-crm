-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'FOLLOW_UP';

-- AlterTable
ALTER TABLE "ContactEvent" ADD COLUMN     "calendarTitle" TEXT,
ADD COLUMN     "calendarUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "durationMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleEventId" TEXT,
ADD COLUMN     "syncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncState" "SyncState" NOT NULL DEFAULT 'SYNCED';

-- CreateTable
CREATE TABLE "CalendarTombstone" (
    "id" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "syncState" "SyncState" NOT NULL DEFAULT 'PENDING',
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarTombstone_googleCalendarId_googleEventId_key" ON "CalendarTombstone"("googleCalendarId", "googleEventId");

-- CreateIndex
CREATE INDEX "ContactEvent_syncState_idx" ON "ContactEvent"("syncState");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEvent_googleCalendarId_googleEventId_key" ON "ContactEvent"("googleCalendarId", "googleEventId");

