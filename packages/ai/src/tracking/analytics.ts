"use server";

import { prisma } from "@life-os/db";
import type { AiCallType, AiCallStatus, Prisma } from "@prisma/client";

/**
 * Summary of AI usage for a user over a time period.
 */
export interface UsageSummary {
  /** Total aggregates */
  totals: {
    totalCalls: number;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  /** Breakdown by model */
  byModel: Array<{
    modelKey: string | null;
    callCount: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  /** Breakdown by thread for attribution */
  byThread: Array<{
    threadId: string;
    threadName: string | null;
    callCount: number;
    costUsd: number;
  }>;
  /** Breakdown by call type */
  byCallType: Array<{
    callType: AiCallType;
    callCount: number;
    costUsd: number;
  }>;
}

/**
 * Get usage summary for a user over a specified number of days.
 *
 * @param userId - The user ID to get usage for
 * @param days - Number of days to look back (default: 30)
 * @returns Usage summary with totals and breakdowns
 */
export async function getUsageSummary(
  userId: string,
  days: number = 30
): Promise<UsageSummary> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [totals, byModel, byThreadRaw, byCallType] = await Promise.all([
    // Total aggregates
    prisma.aiCall.aggregate({
      where: { userId, requestStartAt: { gte: since } },
      _sum: {
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
      },
      _count: true,
    }),

    // By model breakdown
    prisma.aiCall.groupBy({
      by: ["modelKey"],
      where: { userId, requestStartAt: { gte: since } },
      _sum: {
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
      },
      _count: true,
      orderBy: {
        _sum: {
          costUsd: "desc",
        },
      },
    }),

    // By thread (for attribution)
    prisma.aiCall.groupBy({
      by: ["threadId"],
      where: { userId, requestStartAt: { gte: since }, threadId: { not: null } },
      _sum: { costUsd: true },
      _count: true,
      orderBy: {
        _sum: {
          costUsd: "desc",
        },
      },
      take: 10, // Top 10 threads by cost
    }),

    // By call type
    prisma.aiCall.groupBy({
      by: ["callType"],
      where: { userId, requestStartAt: { gte: since } },
      _sum: { costUsd: true },
      _count: true,
      orderBy: {
        _sum: {
          costUsd: "desc",
        },
      },
    }),
  ]);

  // Fetch thread names for the thread breakdown
  const threadIds = byThreadRaw
    .map((t) => t.threadId)
    .filter((id): id is string => id !== null);

  const threads = await prisma.chatThread.findMany({
    where: { id: { in: threadIds } },
    select: { id: true, name: true },
  });

  const threadNameMap = new Map(threads.map((t) => [t.id, t.name]));

  return {
    totals: {
      totalCalls: totals._count,
      totalCostUsd: Number(totals._sum.costUsd ?? 0),
      totalInputTokens: totals._sum.inputTokens ?? 0,
      totalOutputTokens: totals._sum.outputTokens ?? 0,
    },
    byModel: byModel.map((m) => ({
      modelKey: m.modelKey,
      callCount: m._count,
      costUsd: Number(m._sum.costUsd ?? 0),
      inputTokens: m._sum.inputTokens ?? 0,
      outputTokens: m._sum.outputTokens ?? 0,
    })),
    byThread: byThreadRaw.map((t) => ({
      threadId: t.threadId!,
      threadName: threadNameMap.get(t.threadId!) ?? null,
      callCount: t._count,
      costUsd: Number(t._sum.costUsd ?? 0),
    })),
    byCallType: byCallType.map((c) => ({
      callType: c.callType,
      callCount: c._count,
      costUsd: Number(c._sum.costUsd ?? 0),
    })),
  };
}

/**
 * Daily usage data point for charts.
 */
export interface DailyUsage {
  date: string; // ISO date string (YYYY-MM-DD)
  callCount: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Get daily usage data for a user over a specified number of days.
 * Useful for charting usage trends over time.
 *
 * @param userId - The user ID to get usage for
 * @param days - Number of days to look back (default: 30)
 * @returns Array of daily usage data points
 */
export async function getDailyUsage(
  userId: string,
  days: number = 30
): Promise<DailyUsage[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Use raw query for date grouping (Prisma doesn't support date truncation in groupBy)
  const results = await prisma.$queryRaw<
    Array<{
      date: Date;
      call_count: bigint;
      cost_usd: Prisma.Decimal | null;
      input_tokens: bigint | null;
      output_tokens: bigint | null;
    }>
  >`
    SELECT 
      DATE("requestStartAt") as date,
      COUNT(*) as call_count,
      SUM("costUsd") as cost_usd,
      SUM("inputTokens") as input_tokens,
      SUM("outputTokens") as output_tokens
    FROM "AiCall"
    WHERE "userId" = ${userId}
      AND "requestStartAt" >= ${since}
    GROUP BY DATE("requestStartAt")
    ORDER BY date ASC
  `;

  return results.map((r) => ({
    date: r.date.toISOString().split("T")[0],
    callCount: Number(r.call_count),
    costUsd: Number(r.cost_usd ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
  }));
}

/**
 * Recent AI call for the activity feed.
 */
export interface RecentAiCall {
  id: string;
  callType: AiCallType;
  modelKey: string | null;
  providerId: string;
  status: AiCallStatus;
  costUsd: number;
  totalLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requestStartAt: Date;
  threadId: string | null;
  threadName: string | null;
}

/**
 * Get recent AI calls for a user.
 *
 * @param userId - The user ID to get calls for
 * @param limit - Maximum number of calls to return (default: 20)
 * @returns Array of recent AI calls
 */
export async function getRecentAiCalls(
  userId: string,
  limit: number = 20
): Promise<RecentAiCall[]> {
  const calls = await prisma.aiCall.findMany({
    where: { userId },
    orderBy: { requestStartAt: "desc" },
    take: limit,
    select: {
      id: true,
      callType: true,
      modelKey: true,
      providerId: true,
      status: true,
      costUsd: true,
      totalLatencyMs: true,
      inputTokens: true,
      outputTokens: true,
      requestStartAt: true,
      threadId: true,
      thread: {
        select: {
          name: true,
        },
      },
    },
  });

  return calls.map((c) => ({
    id: c.id,
    callType: c.callType,
    modelKey: c.modelKey,
    providerId: c.providerId,
    status: c.status,
    costUsd: Number(c.costUsd),
    totalLatencyMs: c.totalLatencyMs,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    requestStartAt: c.requestStartAt,
    threadId: c.threadId,
    threadName: c.thread?.name ?? null,
  }));
}
