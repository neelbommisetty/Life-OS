import { describe, expect, test } from "bun:test";
import { createAnalyticsRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";

describe("analyticsRoute", () => {
  test("GET /analytics/dashboard returns summary and recent calls", async () => {
    let capturedSummaryArgs: { userId: string; days: number | undefined } | null =
      null;
    let capturedRecentArgs: { userId: string; limit: number | undefined } | null =
      null;

    const app = createTestApp(
      createAnalyticsRoute({
        getUserId: async () => USER_ID,
        getUsageSummary: async (userId, days) => {
          capturedSummaryArgs = { userId, days };
          return {
            totals: {
              totalCalls: 5,
              totalCostUsd: 1.2345,
              totalInputTokens: 1200,
              totalOutputTokens: 800,
            },
            byModel: [],
            byThread: [],
            byCallType: [],
          };
        },
        getRecentAiCalls: async (userId, limit) => {
          capturedRecentArgs = { userId, limit };
          return [
            {
              id: "call_1",
              callType: "CHAT_STREAM",
              modelKey: "openai:gpt-4.1-mini",
              providerId: "openai",
              status: "SUCCESS",
              costUsd: 0.1234,
              totalLatencyMs: 420,
              inputTokens: 100,
              outputTokens: 50,
              requestStartAt: new Date("2026-02-07T01:02:03.000Z"),
              threadId: "thread_1",
              threadName: "Main",
            },
          ];
        },
      }),
    );

    const { response, body } = await requestJson(app, "/analytics/dashboard");
    expect(response.status).toBe(200);
    expect(body.summary.totals.totalCalls).toBe(5);
    expect(body.recentCalls).toHaveLength(1);
    expect(body.recentCalls[0]?.requestStartAt).toBe("2026-02-07T01:02:03.000Z");
    expect(capturedSummaryArgs).toEqual({ userId: USER_ID, days: 30 });
    expect(capturedRecentArgs).toEqual({ userId: USER_ID, limit: 10 });
  });

  test("GET /analytics/dashboard parses query parameters", async () => {
    let capturedSummaryDays: number | undefined;
    let capturedRecentLimit: number | undefined;

    const app = createTestApp(
      createAnalyticsRoute({
        getUserId: async () => USER_ID,
        getUsageSummary: async (_userId, days) => {
          capturedSummaryDays = days;
          return {
            totals: {
              totalCalls: 0,
              totalCostUsd: 0,
              totalInputTokens: 0,
              totalOutputTokens: 0,
            },
            byModel: [],
            byThread: [],
            byCallType: [],
          };
        },
        getRecentAiCalls: async (_userId, limit) => {
          capturedRecentLimit = limit;
          return [];
        },
      }),
    );

    const { response } = await requestJson(
      app,
      "/analytics/dashboard?days=14&limit=25",
    );

    expect(response.status).toBe(200);
    expect(capturedSummaryDays).toBe(14);
    expect(capturedRecentLimit).toBe(25);
  });

  test("GET /analytics/dashboard returns 400 for invalid days", async () => {
    const app = createTestApp(
      createAnalyticsRoute({
        getUserId: async () => USER_ID,
        getUsageSummary: async () => ({
          totals: {
            totalCalls: 0,
            totalCostUsd: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
          },
          byModel: [],
          byThread: [],
          byCallType: [],
        }),
        getRecentAiCalls: async () => [],
      }),
    );

    const { response, body } = await requestJson(
      app,
      "/analytics/dashboard?days=0",
    );

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "invalid_request",
      message: "days must be a positive integer",
    });
  });

  test("GET /analytics/dashboard clamps days and limit to configured maximums", async () => {
    let capturedSummaryDays: number | undefined;
    let capturedRecentLimit: number | undefined;

    const app = createTestApp(
      createAnalyticsRoute({
        getUserId: async () => USER_ID,
        getUsageSummary: async (_userId, days) => {
          capturedSummaryDays = days;
          return {
            totals: {
              totalCalls: 0,
              totalCostUsd: 0,
              totalInputTokens: 0,
              totalOutputTokens: 0,
            },
            byModel: [],
            byThread: [],
            byCallType: [],
          };
        },
        getRecentAiCalls: async (_userId, limit) => {
          capturedRecentLimit = limit;
          return [];
        },
      }),
    );

    const { response } = await requestJson(
      app,
      "/analytics/dashboard?days=999&limit=500",
    );

    expect(response.status).toBe(200);
    expect(capturedSummaryDays).toBe(365);
    expect(capturedRecentLimit).toBe(100);
  });

  test("GET /analytics/dashboard returns 400 for invalid limit", async () => {
    const app = createTestApp(
      createAnalyticsRoute({
        getUserId: async () => USER_ID,
        getUsageSummary: async () => ({
          totals: {
            totalCalls: 0,
            totalCostUsd: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
          },
          byModel: [],
          byThread: [],
          byCallType: [],
        }),
        getRecentAiCalls: async () => [],
      }),
    );

    const { response, body } = await requestJson(
      app,
      "/analytics/dashboard?limit=0",
    );

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "invalid_request",
      message: "limit must be a positive integer",
    });
  });
});
