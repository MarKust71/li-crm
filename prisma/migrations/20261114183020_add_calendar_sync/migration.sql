-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('PENDING', 'SYNCED', 'ERROR');

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "calendarTitle" TEXT,
ADD COLUMN     "calendarUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "syncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncState" "SyncState" NOT NULL DEFAULT 'SYNCED';

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- Kursor odczytu zmian z kalendarza: moment pobrania snapshotu, z którego zaimportowano przypomnienia (14.11.2026 16:15 UTC).
-- Pierwsza synchronizacja pobierze więc wszystko, co zmieniło się w kalendarzu od tamtej pory (np. znaczniki "odbyte").
INSERT INTO "AppSetting" ("key", "value", "updatedAt")
VALUES ('calendarSync.pullCursor', '2026-11-14T16:15:31.162Z', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
