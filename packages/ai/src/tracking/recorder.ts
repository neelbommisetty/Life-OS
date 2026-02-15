import type { Prisma } from "@life-os/db";
import { createLogger } from "../logger";
import { getModelPriceSnapshot } from "../pricing";
import { calculateCallCost } from './cost';
import type { TrackingContext, TrackingResult } from './types';

const logger = createLogger('ai-tracking:recorder');
let dbModulePromise: Promise<typeof import("@life-os/db")> | null = null;

async function getDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = import("@life-os/db");
  }
  return dbModulePromise;
}

/**
 * Asynchronously record an AI call to the database.
 * This function is fire-and-forget - it will not throw errors.
 *
 * @param context - The tracking context from the caller
 * @param tracking - The tracking result populated during the call
 */
export async function recordAiCall(
  context: TrackingContext,
  tracking: TrackingResult
): Promise<void> {
  try {
    const { prisma, Prisma } = await getDbModule();

    // Get pricing snapshot for cost calculation
    const priceSnapshot = getModelPriceSnapshot({
      modelKey: tracking.telemetry?.modelKey ?? null,
    });

    // Calculate costs
    const costs = calculateCallCost(tracking.usage, priceSnapshot);

    // Calculate total latency
    const totalLatencyMs = tracking.responseEndAt
      ? tracking.responseEndAt.getTime() - tracking.requestStartAt.getTime()
      : null;

    // Create the AI call record
    await prisma.aiCall.create({
      data: {
        userId: context.userId,
        threadId: context.threadId ?? null,
        messageId: context.messageId ?? null,
        callType: context.callType,
        providerId: tracking.telemetry?.providerId ?? 'unknown',
        modelKey: tracking.telemetry?.modelKey ?? null,
        modelId: tracking.telemetry?.modelId ?? null,
        inputTokens: tracking.usage?.inputTokens ?? null,
        outputTokens: tracking.usage?.outputTokens ?? null,
        totalTokens: tracking.usage?.totalTokens ?? null,
        cacheCreationInputTokens: tracking.usage?.cacheCreationInputTokens ?? null,
        cacheReadInputTokens: tracking.usage?.cacheReadInputTokens ?? null,
        totalStreamedTokens: tracking.totalStreamedTokens ?? null,
        streamingStartAt: tracking.streamingStartAt ?? null,
        streamingEndAt: tracking.streamingEndAt ?? null,
        streamingTps: tracking.streamingTps ?? null,
        requestStartAt: tracking.requestStartAt,
        firstTokenAt: tracking.firstTokenAt ?? null,
        responseEndAt: tracking.responseEndAt ?? null,
        totalLatencyMs,
        costUsd: costs.costUsd,
        cacheCreationCostUsd: costs.cacheCreationCostUsd ?? null,
        cacheReadCostUsd: costs.cacheReadCostUsd ?? null,
        priceSnapshot: priceSnapshot as Prisma.InputJsonValue,
        status: tracking.status,
        attempts: tracking.telemetry?.attempts
          ? (JSON.parse(JSON.stringify(tracking.telemetry.attempts)) as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    logger.debug('Recorded AI call', {
      callType: context.callType,
      providerId: tracking.telemetry?.providerId,
      modelKey: tracking.telemetry?.modelKey,
      costUsd: costs.costUsd,
      totalLatencyMs,
      status: tracking.status,
    });
  } catch (error) {
    // Non-blocking: log error but don't throw
    // This ensures tracking failures don't affect the main request
    logger.error('Failed to record AI call', {
      callType: context.callType,
      userId: context.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update an existing AI call record with additional data.
 * Useful for setting messageId after the message is created.
 *
 * @param aiCallId - The ID of the AI call to update
 * @param data - Partial data to update
 */
export async function updateAiCall(
  aiCallId: string,
  data: Prisma.AiCallUpdateInput
): Promise<void> {
  try {
    const { prisma } = await getDbModule();
    await prisma.aiCall.update({
      where: { id: aiCallId },
      data,
    });

    logger.debug('Updated AI call', { aiCallId, ...data });
  } catch (error) {
    logger.error('Failed to update AI call', {
      aiCallId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
