-- CreateTable
CREATE TABLE "CandidateView" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateView_candidateId_viewedAt_idx" ON "CandidateView"("candidateId", "viewedAt");

-- AddForeignKey
ALTER TABLE "CandidateView" ADD CONSTRAINT "CandidateView_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

