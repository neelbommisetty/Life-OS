-- AlterTable
ALTER TABLE "ChatThread" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "lastChattedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "name" SET DEFAULT 'New thread';

-- CreateIndex
CREATE INDEX "ChatThread_projectId_archivedAt_lastChattedAt_idx" ON "ChatThread"("projectId", "archivedAt", "lastChattedAt");
