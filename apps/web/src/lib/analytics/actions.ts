"use server";

import { apiFetchJson } from "@/lib/api/fetch";

export type UsageSummary = {
  totals: {
    totalCalls: number;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  byModel: Array<{
    modelKey: string | null;
    callCount: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byThread: Array<{
    threadId: string;
    threadName: string | null;
    callCount: number;
    costUsd: number;
  }>;
  byCallType: Array<{
    callType: string;
    callCount: number;
    costUsd: number;
  }>;
};

type RecentAiCallResponse = {
  id: string;
  callType: string;
  modelKey: string | null;
  providerId: string;
  status: string;
  costUsd: number;
  totalLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requestStartAt: string;
  threadId: string | null;
  threadName: string | null;
};

export type RecentAiCall = Omit<RecentAiCallResponse, "requestStartAt"> & {
  requestStartAt: Date;
};

type AnalyticsDashboardResponse = {
  summary: UsageSummary;
  recentCalls: RecentAiCallResponse[];
};

export type AnalyticsDashboard = {
  summary: UsageSummary;
  recentCalls: RecentAiCall[];
};

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date received from API");
  }
  return parsed;
}

function hydrateRecentCall(call: RecentAiCallResponse): RecentAiCall {
  return {
    ...call,
    requestStartAt: parseDate(call.requestStartAt),
  };
}

type GetAnalyticsDashboardInput = {
  days?: number;
  limit?: number;
};

export async function getAnalyticsDashboard(
  input: GetAnalyticsDashboardInput = {},
): Promise<AnalyticsDashboard> {
  const params = new URLSearchParams();
  if (input.days !== undefined) {
    params.set("days", String(input.days));
  }
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }

  const path = params.size
    ? `/api/analytics/dashboard?${params.toString()}`
    : "/api/analytics/dashboard";

  const response = await apiFetchJson<AnalyticsDashboardResponse>(path);

  return {
    summary: response.summary,
    recentCalls: response.recentCalls.map(hydrateRecentCall),
  };
}
