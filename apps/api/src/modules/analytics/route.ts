import { Hono } from "hono";
import {
  getRecentAiCalls as getRecentAiCallsFromTracking,
  getUsageSummary as getUsageSummaryFromTracking,
  type RecentAiCall,
  type UsageSummary,
} from "@life-os/ai/tracking";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { badRequestError } from "../common/errors.js";
import { handleRouteError, parseNumberQuery } from "../common/http.js";

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 10;
const MAX_DAYS = 365;
const MAX_LIMIT = 100;

type AnalyticsRouteDependencies = {
  getUserId?: (request: Request) => Promise<string>;
  getUsageSummary?: (userId: string, days?: number) => Promise<UsageSummary>;
  getRecentAiCalls?: (userId: string, limit?: number) => Promise<RecentAiCall[]>;
};

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  max: number,
) {
  const parsed = parseNumberQuery(value);
  if (parsed === undefined) {
    return fallback;
  }

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequestError(`${name} must be a positive integer`);
  }

  return Math.min(parsed, max);
}

export function createAnalyticsRoute(
  dependencies: AnalyticsRouteDependencies = {},
) {
  const analyticsRoute = new Hono();
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;
  const getUsageSummary =
    dependencies.getUsageSummary ?? getUsageSummaryFromTracking;
  const getRecentAiCalls =
    dependencies.getRecentAiCalls ?? getRecentAiCallsFromTracking;

  const getDashboardHandler = async (request: Request) => {
    const url = new URL(request.url);
    const days = parsePositiveInteger(
      url.searchParams.get("days") ?? undefined,
      DEFAULT_DAYS,
      "days",
      MAX_DAYS,
    );
    const limit = parsePositiveInteger(
      url.searchParams.get("limit") ?? undefined,
      DEFAULT_LIMIT,
      "limit",
      MAX_LIMIT,
    );

    const userId = await getUserId(request);
    const [summary, recentCalls] = await Promise.all([
      getUsageSummary(userId, days),
      getRecentAiCalls(userId, limit),
    ]);

    return { summary, recentCalls };
  };
  analyticsRoute.get("/analytics/dashboard", async (c) => {
    try {
      return c.json(await getDashboardHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
  return analyticsRoute;
}

export const analyticsRoute = createAnalyticsRoute();
