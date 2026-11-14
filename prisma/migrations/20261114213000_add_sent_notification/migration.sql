-- CreateTable
CREATE TABLE "SentNotification" (
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentNotification_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SentNotification_sentAt_idx" ON "SentNotification"("sentAt");

