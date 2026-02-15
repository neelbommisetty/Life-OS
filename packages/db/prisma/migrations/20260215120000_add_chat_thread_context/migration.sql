-- CreateTable
CREATE TABLE "ChatThreadContext" (
    "threadId" TEXT NOT NULL,
    "baseContext" TEXT NOT NULL DEFAULT '',
    "conversationContext" TEXT NOT NULL DEFAULT '',
    "conversationTokenCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatThreadContext_pkey" PRIMARY KEY ("threadId")
);

-- AddForeignKey
ALTER TABLE "ChatThreadContext" ADD CONSTRAINT "ChatThreadContext_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
