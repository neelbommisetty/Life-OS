-- AlterTable
ALTER TABLE "ChatMessage"
  ADD COLUMN IF NOT EXISTS "tokenCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "tokenCountSource" TEXT;
