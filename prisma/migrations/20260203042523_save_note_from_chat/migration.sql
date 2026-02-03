-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "savedNoteId" TEXT;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "sourceMessageId" TEXT;

-- CreateIndex
CREATE INDEX "ChatMessage_savedNoteId_idx" ON "ChatMessage"("savedNoteId");

-- CreateIndex
CREATE INDEX "Note_sourceMessageId_idx" ON "Note"("sourceMessageId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_savedNoteId_fkey" FOREIGN KEY ("savedNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
