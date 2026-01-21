-- CreateEnum
CREATE TYPE "AiCallType" AS ENUM ('CHAT_STREAM', 'CHAT_BLOCKING', 'SUMMARY_CALL', 'TITLE_GEN_CALL');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCESS', 'ERROR', 'ABORTED');

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "messageId" TEXT,
    "callType" "AiCallType" NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelKey" TEXT,
    "modelId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cacheCreationInputTokens" INTEGER,
    "cacheReadInputTokens" INTEGER,
    "totalStreamedTokens" INTEGER,
    "streamingStartAt" TIMESTAMP(3),
    "streamingEndAt" TIMESTAMP(3),
    "streamingTps" DOUBLE PRECISION,
    "requestStartAt" TIMESTAMP(3) NOT NULL,
    "firstTokenAt" TIMESTAMP(3),
    "responseEndAt" TIMESTAMP(3),
    "totalLatencyMs" INTEGER,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "cacheCreationCostUsd" DECIMAL(12,6),
    "cacheReadCostUsd" DECIMAL(12,6),
    "priceSnapshot" JSONB NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "attempts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCall_userId_requestStartAt_idx" ON "AiCall"("userId", "requestStartAt");

-- CreateIndex
CREATE INDEX "AiCall_threadId_requestStartAt_idx" ON "AiCall"("threadId", "requestStartAt");

-- CreateIndex
CREATE INDEX "AiCall_providerId_modelId_idx" ON "AiCall"("providerId", "modelId");

-- CreateIndex
CREATE INDEX "AiCall_callType_idx" ON "AiCall"("callType");

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
