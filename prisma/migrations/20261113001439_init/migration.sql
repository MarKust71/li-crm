-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('SEARCH', 'VIEWERS', 'PYMK', 'SUGGESTIONS', 'PROFILE', 'MORE_PROFILES', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('CAPTURED', 'INVITED', 'ACCEPTED', 'THANKED', 'ASKED_OPEN', 'OPEN_TO_TALK', 'NOT_INTERESTED', 'MEETING_PROPOSED', 'BP_SCHEDULED', 'BP_COMPLETED', 'DECISION_YES', 'DECISION_NO');

-- CreateEnum
CREATE TYPE "ArchiveReason" AS ENUM ('NO_CONVERSATION', 'INVITE_REJECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('INVITE_SENT', 'INVITE_RECEIVED', 'ACCEPTED', 'REACTION_RECEIVED', 'THANKS_SENT', 'ASKED_OPEN', 'ASKED_OPEN_REMINDER', 'ASKED_OPEN_RESPONSE', 'OPEN_TO_TALK', 'NOT_INTERESTED', 'MEETING_PROPOSED', 'MEETING_PROPOSAL_REMINDER', 'BP_SCHEDULED', 'BP_CONFIRMED', 'BP_CANCELED', 'BP_NO_SHOW', 'BP_COMPLETED', 'DECISION_YES', 'DECISION_NO', 'VIEWED_MY_PROFILE', 'NOTE');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salutation" TEXT,
    "location" TEXT,
    "occupation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "openToWork" BOOLEAN NOT NULL DEFAULT false,
    "direction" "Direction" NOT NULL DEFAULT 'OUTBOUND',
    "source" "Source" NOT NULL DEFAULT 'MANUAL',
    "contactFrom" TEXT,
    "stage" "Stage" NOT NULL DEFAULT 'CAPTURED',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" "ArchiveReason",
    "archivedAt" TIMESTAMP(3),
    "info" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "source" "Source" NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "activityTypeId" TEXT,
    "count" INTEGER,
    "note" TEXT,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_profileUrl_key" ON "Contact"("profileUrl");

-- CreateIndex
CREATE INDEX "Contact_stage_idx" ON "Contact"("stage");

-- CreateIndex
CREATE INDEX "Contact_direction_stage_archived_idx" ON "Contact"("direction", "stage", "archived");

-- CreateIndex
CREATE INDEX "ContactEvent_contactId_occurredAt_idx" ON "ContactEvent"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "ContactEvent_type_occurredAt_idx" ON "ContactEvent"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Capture_receivedAt_idx" ON "Capture"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityType_name_key" ON "ActivityType"("name");

-- CreateIndex
CREATE INDEX "TimeEntry_startedAt_idx" ON "TimeEntry"("startedAt");

-- AddForeignKey
ALTER TABLE "ContactEvent" ADD CONSTRAINT "ContactEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capture" ADD CONSTRAINT "Capture_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
