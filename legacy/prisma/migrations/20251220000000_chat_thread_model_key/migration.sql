-- Add model selection to chat threads
ALTER TABLE "ChatThread" ADD COLUMN "modelKey" TEXT;
