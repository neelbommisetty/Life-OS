import { Prisma, type PrismaClient } from "@prisma/client";
import type { ModelCallAttempt, ModelCallTelemetry, ModelUsage } from "@/lib/ai/core";
import { getModelPriceSnapshot } from "@/lib/ai/pricing";
import { createLogger } from "@/lib/logger";

export type AiCallContext = {
  projectId: string;
  threadId?: string | null;
  userId?: string | null;
  source: string;
  actionType: string;
  artifactRef?: string | null;
  metadataTags?: string[];
};

export type AiCallTiming = {
  requestStartAt: Date;
  firstTokenAt?: Date | null;
  responseEndAt?: Date | null;
  streamingStartAt?: Date | null;
  streamingEndAt?: Date | null;
};

const logger = createLogger("ai:telemetry");

const estimateTokens = (text?: string | null): number => {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
};

const resolveModelInfo = (telemetry?: ModelCallTelemetry): {
  providerId?: string;
  modelKey?: string;
  modelId?: string;
  attempts?: ModelCallAttempt[];
} => {
  const attempts = telemetry?.attempts ? [...telemetry.attempts] : undefined;
  const successAttempt = attempts?.find((attempt) => attempt.status === "success");

  const modelKey =
    telemetry?.modelKey ?? successAttempt?.modelKey ?? undefined;
  const providerId =
    telemetry?.providerId ??
    successAttempt?.providerId ??
    (modelKey ? modelKey.split(".")[0] : undefined);
  const modelId = telemetry?.modelId ?? successAttempt?.modelId ?? undefined;

  return {
    providerId,
    modelKey,
    modelId,
    attempts,
  };
};

export const getTelemetryFromError = (error: unknown): ModelCallTelemetry | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  return (error as { aiTelemetry?: ModelCallTelemetry }).aiTelemetry;
};

export const recordAiCall = async (params: {
  prisma: PrismaClient;
  context: AiCallContext;
  prompt: string;
  outputText?: string | null;
  usage?: ModelUsage;
  telemetry?: ModelCallTelemetry;
  timing: AiCallTiming;
  status: "SUCCESS" | "ERROR" | "ABORTED";
  totalStreamedTokens?: number | null;
}): Promise<void> => {
  const {
    prisma,
    context,
    prompt,
    outputText,
    usage,
    telemetry,
    timing,
    status,
    totalStreamedTokens,
  } = params;

  try {
    const resolved = resolveModelInfo(telemetry);
    const inputTokens =
      usage?.inputTokens ?? estimateTokens(prompt);
    const outputTokens =
      usage?.outputTokens ?? estimateTokens(outputText);
    const cacheCreationInputTokens = usage?.cacheCreationInputTokens ?? null;
    const cacheReadInputTokens = usage?.cacheReadInputTokens ?? null;
    const totalTokens =
      usage?.totalTokens ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined);

    const streamingStartAt = timing.streamingStartAt ?? null;
    const streamingEndAt = timing.streamingEndAt ?? null;
    const responseEndAt = timing.responseEndAt ?? null;
    const firstTokenAt = timing.firstTokenAt ?? null;
    const totalLatencyMs = responseEndAt
      ? responseEndAt.getTime() - timing.requestStartAt.getTime()
      : null;

    const resolvedStreamedTokens =
      totalStreamedTokens ??
      (streamingStartAt && streamingEndAt ? outputTokens : null);

    const streamingDurationMs =
      streamingStartAt && streamingEndAt
        ? streamingEndAt.getTime() - streamingStartAt.getTime()
        : null;

    const streamingTps =
      streamingDurationMs && streamingDurationMs > 0 && resolvedStreamedTokens
        ? resolvedStreamedTokens / (streamingDurationMs / 1000)
        : null;

    const priceSnapshot = getModelPriceSnapshot({
      modelKey: resolved.modelKey ?? null,
    });

    const inputRate = priceSnapshot.inputUsdPer1m ?? 0;
    const outputRate = priceSnapshot.outputUsdPer1m ?? 0;
    const cacheCreationRate =
      priceSnapshot.cacheCreationInputUsdPer1m ?? inputRate;
    const cacheReadRate =
      priceSnapshot.cacheReadInputUsdPer1m ?? inputRate;

    const nonCachedInputTokens =
      inputTokens !== undefined
        ? Math.max(
            inputTokens -
              (cacheCreationInputTokens ?? 0) -
              (cacheReadInputTokens ?? 0),
            0
          )
        : 0;

    const cacheCreationInputCost =
      cacheCreationInputTokens !== null && cacheCreationInputTokens !== undefined
        ? (cacheCreationInputTokens / 1_000_000) * cacheCreationRate
        : null;
    const cacheReadInputCost =
      cacheReadInputTokens !== null && cacheReadInputTokens !== undefined
        ? (cacheReadInputTokens / 1_000_000) * cacheReadRate
        : null;
    const inputCost =
      ((nonCachedInputTokens ?? 0) / 1_000_000) * inputRate;
    const outputCost =
      ((outputTokens ?? 0) / 1_000_000) * outputRate;

    const computedCost =
      inputCost +
      outputCost +
      (cacheCreationInputCost ?? 0) +
      (cacheReadInputCost ?? 0);

    await prisma.aiCall.create({
      data: {
        projectId: context.projectId,
        threadId: context.threadId ?? null,
        userId: context.userId ?? null,
        source: context.source,
        actionType: context.actionType,
        providerId: resolved.providerId ?? "unknown",
        modelKey: resolved.modelKey ?? null,
        modelId: resolved.modelId ?? null,
        inputTokens,
        outputTokens,
        totalTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
        totalStreamedTokens: resolvedStreamedTokens ?? null,
        streamingStartAt,
        streamingEndAt,
        streamingTps,
        requestStartAt: timing.requestStartAt,
        firstTokenAt,
        responseEndAt,
        queueMs: null,
        modelMs: null,
        totalLatencyMs,
        cacheCreationInputCostUsd:
          cacheCreationInputCost !== null
            ? new Prisma.Decimal(cacheCreationInputCost.toFixed(6))
            : null,
        cacheReadInputCostUsd:
          cacheReadInputCost !== null
            ? new Prisma.Decimal(cacheReadInputCost.toFixed(6))
            : null,
        costUsd: new Prisma.Decimal(computedCost.toFixed(6)),
        priceSnapshot,
        status,
        artifactRef: context.artifactRef ?? null,
        metadataTags: context.metadataTags ?? [],
        attempts: resolved.attempts ? (resolved.attempts as any) : undefined,
      },
    });
  } catch (error) {
    logger.warn("Failed to record AI call", {
      projectId: context.projectId,
      actionType: context.actionType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
