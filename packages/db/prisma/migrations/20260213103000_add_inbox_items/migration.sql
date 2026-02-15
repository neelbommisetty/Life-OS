-- CreateEnum
CREATE TYPE "InboxItemState" AS ENUM ('SAVED', 'PROCESSING', 'REVIEW', 'PROCESSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "state" "InboxItemState" NOT NULL DEFAULT 'SAVED',
    "processedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxItem_userId_idx" ON "InboxItem"("userId");

-- CreateIndex
CREATE INDEX "InboxItem_userId_state_createdAt_idx" ON "InboxItem"("userId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "InboxItem_userId_archivedAt_idx" ON "InboxItem"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "InboxItem_userId_processedAt_idx" ON "InboxItem"("userId", "processedAt");
