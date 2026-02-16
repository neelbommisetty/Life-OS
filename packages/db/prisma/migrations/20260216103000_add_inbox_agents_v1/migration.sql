-- CreateEnum
CREATE TYPE "InboxProposalOutputState" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "InboxProposalAction" AS ENUM ('APPROVE', 'DECLINE', 'RETRY', 'SKIP');

-- CreateEnum
CREATE TYPE "InboxAgentKey" AS ENUM ('KB_NOTE', 'TODO_LIST');

-- AlterTable
ALTER TABLE "InboxItem"
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "processingError" TEXT,
ADD COLUMN "agentConfigSnapshot" JSONB;

-- CreateTable
CREATE TABLE "InboxProposalOutput" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inboxItemId" TEXT NOT NULL,
    "agentKey" "InboxAgentKey" NOT NULL,
    "outputIndex" INTEGER NOT NULL,
    "payloadVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadPreview" TEXT NOT NULL,
    "state" "InboxProposalOutputState" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdArtifacts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxProposalOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxProposalActionIdempotency" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposalOutputId" TEXT NOT NULL,
    "action" "InboxProposalAction" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxProposalActionIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxAgentUserSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentKey" "InboxAgentKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxAgentUserSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboxProposalOutput_inboxItemId_agentKey_outputIndex_key" ON "InboxProposalOutput"("inboxItemId", "agentKey", "outputIndex");

-- CreateIndex
CREATE INDEX "InboxProposalOutput_userId_inboxItemId_idx" ON "InboxProposalOutput"("userId", "inboxItemId");

-- CreateIndex
CREATE INDEX "InboxProposalOutput_userId_state_createdAt_idx" ON "InboxProposalOutput"("userId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxProposalActionIdempotency_proposalOutputId_action_idempotencyKey_key" ON "InboxProposalActionIdempotency"("proposalOutputId", "action", "idempotencyKey");

-- CreateIndex
CREATE INDEX "InboxProposalActionIdempotency_userId_proposalOutputId_action_idx" ON "InboxProposalActionIdempotency"("userId", "proposalOutputId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "InboxAgentUserSetting_userId_agentKey_key" ON "InboxAgentUserSetting"("userId", "agentKey");

-- CreateIndex
CREATE INDEX "InboxAgentUserSetting_userId_idx" ON "InboxAgentUserSetting"("userId");

-- AddForeignKey
ALTER TABLE "InboxProposalOutput" ADD CONSTRAINT "InboxProposalOutput_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "InboxItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxProposalActionIdempotency" ADD CONSTRAINT "InboxProposalActionIdempotency_proposalOutputId_fkey" FOREIGN KEY ("proposalOutputId") REFERENCES "InboxProposalOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;
