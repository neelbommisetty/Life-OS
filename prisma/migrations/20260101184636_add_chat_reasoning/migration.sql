-- AlterTable
ALTER TABLE "AiCall" ADD COLUMN     "reasoningTokens" INTEGER;

-- AlterTable
ALTER TABLE "ChatThread" ADD COLUMN     "reasoningEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChatMessageReasoning" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "tokenCountSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMessageReasoning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageReasoning_messageId_key" ON "ChatMessageReasoning"("messageId");

-- AddForeignKey
ALTER TABLE "ChatMessageReasoning" ADD CONSTRAINT "ChatMessageReasoning_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
