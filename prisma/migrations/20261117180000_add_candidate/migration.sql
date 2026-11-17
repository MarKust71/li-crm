-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'REJECTED');

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occupation" TEXT,
    "openToWork" BOOLEAN NOT NULL DEFAULT false,
    "source" "Source" NOT NULL DEFAULT 'PYMK',
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_profileUrl_key" ON "Candidate"("profileUrl");

-- CreateIndex
CREATE INDEX "Candidate_status_lastSeenAt_idx" ON "Candidate"("status", "lastSeenAt");

