-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCESS', 'ERROR', 'ABORTED');

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "threadId" TEXT,
    "userId" TEXT,
    "source" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
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
    "queueMs" INTEGER,
    "modelMs" INTEGER,
    "totalLatencyMs" INTEGER,
    "cacheCreationInputCostUsd" DECIMAL(12,6),
    "cacheReadInputCostUsd" DECIMAL(12,6),
    "costUsd" DECIMAL(12,6) NOT NULL,
    "priceSnapshot" JSONB NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "artifactRef" TEXT,
    "metadataTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCall_projectId_requestStartAt_idx" ON "AiCall"("projectId", "requestStartAt");

-- CreateIndex
CREATE INDEX "AiCall_threadId_requestStartAt_idx" ON "AiCall"("threadId", "requestStartAt");

-- CreateIndex
CREATE INDEX "AiCall_userId_requestStartAt_idx" ON "AiCall"("userId", "requestStartAt");

-- CreateIndex
CREATE INDEX "AiCall_providerId_modelId_idx" ON "AiCall"("providerId", "modelId");

-- CreateIndex
CREATE INDEX "AiCall_source_actionType_idx" ON "AiCall"("source", "actionType");

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
