import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { publicProcedure, router } from "../trpc";

const logger = createLogger("trpc:ai-usage");

const scopeBaseSchema = z.object({
  scope: z.enum(["global", "project", "thread", "user"]),
  projectId: z.string().cuid().optional(),
  threadId: z.string().cuid().optional(),
  userId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const applyScopeRefinement = <T extends typeof scopeBaseSchema>(schema: T) =>
  schema.refine(
    (value) => {
      if (value.scope === "project") {
        return Boolean(value.projectId);
      }
      if (value.scope === "thread") {
        return Boolean(value.threadId);
      }
      if (value.scope === "user") {
        return Boolean(value.userId);
      }
      return true;
    },
    {
      message: "Scope requires the matching identifier.",
    }
  );

const scopeSchema = applyScopeRefinement(scopeBaseSchema);

const filtersBaseSchema = scopeBaseSchema.extend({
  providerId: z.string().optional(),
  modelKey: z.string().optional(),
  modelId: z.string().optional(),
  actionType: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(["SUCCESS", "ERROR", "ABORTED"]).optional(),
});

const filtersSchema = applyScopeRefinement(filtersBaseSchema);

const filtersWithLimitSchema = applyScopeRefinement(
  filtersBaseSchema.extend({
    limit: z.number().int().min(1).max(200).optional(),
  })
);

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  return Number(value);
};

const buildWhereInput = (filters: {
  projectId?: string;
  threadId?: string;
  userId?: string;
  providerId?: string;
  modelKey?: string;
  modelId?: string;
  actionType?: string;
  source?: string;
  status?: string;
  from?: Date;
  to?: Date;
}): Prisma.AiCallWhereInput => ({
  ...(filters.projectId ? { projectId: filters.projectId } : {}),
  ...(filters.threadId ? { threadId: filters.threadId } : {}),
  ...(filters.userId ? { userId: filters.userId } : {}),
  ...(filters.providerId ? { providerId: filters.providerId } : {}),
  ...(filters.modelKey ? { modelKey: filters.modelKey } : {}),
  ...(filters.modelId ? { modelId: filters.modelId } : {}),
  ...(filters.actionType ? { actionType: filters.actionType } : {}),
  ...(filters.source ? { source: filters.source } : {}),
  ...(filters.status ? { status: filters.status as Prisma.AiCallStatus } : {}),
  ...(filters.from || filters.to
    ? {
        requestStartAt: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      }
    : {}),
});

const computePercentile = (values: number[], percentile: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower] ?? 0;
  }
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? 0;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
};

const buildWhereClause = (
  filters: {
    projectId?: string;
    threadId?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    providerId?: string;
    modelKey?: string;
    modelId?: string;
    actionType?: string;
    source?: string;
    status?: string;
  },
  extraClauses: Prisma.Sql[] = []
): Prisma.Sql => {
  const clauses: Prisma.Sql[] = [...extraClauses];

  if (filters.projectId) {
    clauses.push(Prisma.sql`"projectId" = ${filters.projectId}`);
  }
  if (filters.threadId) {
    clauses.push(Prisma.sql`"threadId" = ${filters.threadId}`);
  }
  if (filters.userId) {
    clauses.push(Prisma.sql`"userId" = ${filters.userId}`);
  }
  if (filters.providerId) {
    clauses.push(Prisma.sql`"providerId" = ${filters.providerId}`);
  }
  if (filters.modelKey) {
    clauses.push(Prisma.sql`"modelKey" = ${filters.modelKey}`);
  }
  if (filters.modelId) {
    clauses.push(Prisma.sql`"modelId" = ${filters.modelId}`);
  }
  if (filters.actionType) {
    clauses.push(Prisma.sql`"actionType" = ${filters.actionType}`);
  }
  if (filters.source) {
    clauses.push(Prisma.sql`"source" = ${filters.source}`);
  }
  if (filters.status) {
    clauses.push(Prisma.sql`"status" = ${filters.status}`);
  }
  if (filters.from) {
    clauses.push(Prisma.sql`"requestStartAt" >= ${filters.from}::timestamp`);
  }
  if (filters.to) {
    clauses.push(Prisma.sql`"requestStartAt" <= ${filters.to}::timestamp`);
  }

  if (clauses.length === 0) {
    return Prisma.sql``;
  }

  return Prisma.sql`WHERE ${Prisma.join(clauses, Prisma.sql` AND `)}`;
};

export const aiUsageRouter = router({
  listCalls: publicProcedure
    .input(
      z.object({
        projectId: z.string().cuid().optional(),
        threadId: z.string().cuid().optional(),
        userId: z.string().optional(),
        providerId: z.string().optional(),
        modelKey: z.string().optional(),
        modelId: z.string().optional(),
        actionType: z.string().optional(),
        source: z.string().optional(),
        status: z.enum(["SUCCESS", "ERROR", "ABORTED"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const start = Date.now();
      const limit = input.limit ?? 50;

      const where = buildWhereInput({
        projectId: input.projectId,
        threadId: input.threadId,
        userId: input.userId,
        providerId: input.providerId,
        modelKey: input.modelKey,
        modelId: input.modelId,
        actionType: input.actionType,
        source: input.source,
        status: input.status,
        from: input.from,
        to: input.to,
      });

      const calls = await ctx.prisma.aiCall.findMany({
        where,
        orderBy: { requestStartAt: "desc" },
        take: limit,
        include: {
          project: {
            select: { name: true },
          },
        },
      });

      logger.debug("Listed AI calls", {
        durationMs: Date.now() - start,
        count: calls.length,
      });

      return calls.map((call) => ({
        ...call,
        costUsd: toNumber(call.costUsd),
        cacheCreationInputCostUsd:
          call.cacheCreationInputCostUsd !== null
            ? toNumber(call.cacheCreationInputCostUsd)
            : null,
        cacheReadInputCostUsd:
          call.cacheReadInputCostUsd !== null
            ? toNumber(call.cacheReadInputCostUsd)
            : null,
      }));
    }),

  getSummary: publicProcedure.input(filtersSchema).query(async ({ ctx, input }) => {
    const start = Date.now();
    const filters = {
      projectId: input.projectId,
      threadId: input.threadId,
      userId: input.userId,
      from: input.from,
      to: input.to,
      providerId: input.providerId,
      modelKey: input.modelKey,
      modelId: input.modelId,
      actionType: input.actionType,
      source: input.source,
      status: input.status,
    };

    const where = buildWhereInput(filters);

    const [aggregate, tokens] = await Promise.all([
      ctx.prisma.aiCall.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          cacheCreationInputTokens: true,
          cacheReadInputTokens: true,
          costUsd: true,
          cacheCreationInputCostUsd: true,
          cacheReadInputCostUsd: true,
        },
        _avg: {
          totalTokens: true,
          streamingTps: true,
          costUsd: true,
        },
        _max: {
          streamingTps: true,
        },
      }),
      ctx.prisma.aiCall.findMany({
        where,
        select: { totalTokens: true },
      }),
    ]);

    const tokenValues = tokens
      .map((row) => row.totalTokens)
      .filter((value): value is number => typeof value === "number");

    logger.debug("Fetched AI summary", {
      durationMs: Date.now() - start,
      scope: input.scope,
    });

    return {
      totalCalls: aggregate._count._all ?? 0,
      totalInputTokens: toNumber(aggregate._sum.inputTokens),
      totalOutputTokens: toNumber(aggregate._sum.outputTokens),
      totalTokens: toNumber(aggregate._sum.totalTokens),
      totalCacheCreationInputTokens: toNumber(aggregate._sum.cacheCreationInputTokens),
      totalCacheReadInputTokens: toNumber(aggregate._sum.cacheReadInputTokens),
      avgTokensPerCall: toNumber(aggregate._avg.totalTokens),
      medianTokensPerCall: computePercentile(tokenValues, 0.5),
      p95TokensPerCall: computePercentile(tokenValues, 0.95),
      avgStreamingTps: toNumber(aggregate._avg.streamingTps),
      maxStreamingTps: toNumber(aggregate._max.streamingTps),
      totalCostUsd: toNumber(aggregate._sum.costUsd),
      totalCacheCreationInputCostUsd: toNumber(aggregate._sum.cacheCreationInputCostUsd),
      totalCacheReadInputCostUsd: toNumber(aggregate._sum.cacheReadInputCostUsd),
      avgCostPerCall: toNumber(aggregate._avg.costUsd),
    };
  }),

  getBreakdowns: publicProcedure.input(filtersSchema).query(async ({ ctx, input }) => {
    const filters = {
      projectId: input.projectId,
      threadId: input.threadId,
      userId: input.userId,
      from: input.from,
      to: input.to,
      providerId: input.providerId,
      modelKey: input.modelKey,
      modelId: input.modelId,
      actionType: input.actionType,
      source: input.source,
      status: input.status,
    };

    const where = buildWhereClause(filters);
    const [totals] = await ctx.prisma.$queryRaw<
      Array<{ totalCostUsd: Prisma.Decimal | null }>
    >(Prisma.sql`
      SELECT COALESCE(SUM("costUsd"), 0) AS "totalCostUsd"
      FROM "AiCall"
      ${where}
    `);

    const totalCost = toNumber(totals?.totalCostUsd);

    const providers = await ctx.prisma.$queryRaw<
      Array<{ providerId: string; callCount: number; costUsd: Prisma.Decimal | null }>
    >(Prisma.sql`
      SELECT
        "providerId" AS "providerId",
        COUNT(*)::int AS "callCount",
        COALESCE(SUM("costUsd"), 0) AS "costUsd"
      FROM "AiCall"
      ${where}
      GROUP BY "providerId"
      ORDER BY "callCount" DESC
    `);

    const models = await ctx.prisma.$queryRaw<
      Array<{
        providerId: string;
        modelId: string | null;
        modelKey: string | null;
        callCount: number;
        costUsd: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT
        "providerId" AS "providerId",
        "modelId" AS "modelId",
        "modelKey" AS "modelKey",
        COUNT(*)::int AS "callCount",
        COALESCE(SUM("costUsd"), 0) AS "costUsd"
      FROM "AiCall"
      ${where}
      GROUP BY "providerId", "modelId", "modelKey"
      ORDER BY "callCount" DESC
    `);

    return {
      providers: providers.map((provider) => {
        const cost = toNumber(provider.costUsd);
        return {
          providerId: provider.providerId,
          callCount: provider.callCount,
          costUsd: cost,
          costShare: totalCost > 0 ? cost / totalCost : 0,
        };
      }),
      models: models.map((model) => {
        const cost = toNumber(model.costUsd);
        return {
          providerId: model.providerId,
          modelId: model.modelId,
          modelKey: model.modelKey,
          callCount: model.callCount,
          costUsd: cost,
          costShare: totalCost > 0 ? cost / totalCost : 0,
        };
      }),
    };
  }),

  getTimeSeries: publicProcedure.input(filtersSchema).query(async ({ ctx, input }) => {
    const filters = {
      projectId: input.projectId,
      threadId: input.threadId,
      userId: input.userId,
      from: input.from,
      to: input.to,
      providerId: input.providerId,
      modelKey: input.modelKey,
      modelId: input.modelId,
      actionType: input.actionType,
      source: input.source,
      status: input.status,
    };

    const where = buildWhereClause(filters);

    const rows = await ctx.prisma.$queryRaw<
      Array<{
        day: Date;
        totalTokens: number | null;
        costUsd: Prisma.Decimal | null;
        cacheCreationInputTokens: number | null;
        cacheReadInputTokens: number | null;
        cacheCreationInputCostUsd: Prisma.Decimal | null;
        cacheReadInputCostUsd: Prisma.Decimal | null;
      }>
    >(Prisma.sql`
      SELECT
        date_trunc('day', "requestStartAt") AS "day",
        COALESCE(SUM("totalTokens"), 0) AS "totalTokens",
        COALESCE(SUM("costUsd"), 0) AS "costUsd",
        COALESCE(SUM("cacheCreationInputTokens"), 0) AS "cacheCreationInputTokens",
        COALESCE(SUM("cacheReadInputTokens"), 0) AS "cacheReadInputTokens",
        COALESCE(SUM("cacheCreationInputCostUsd"), 0) AS "cacheCreationInputCostUsd",
        COALESCE(SUM("cacheReadInputCostUsd"), 0) AS "cacheReadInputCostUsd"
      FROM "AiCall"
      ${where}
      GROUP BY date_trunc('day', "requestStartAt")
      ORDER BY "day" ASC
    `);

    return rows.map((row) => ({
      day: row.day,
      totalTokens: toNumber(row.totalTokens),
      costUsd: toNumber(row.costUsd),
      cacheCreationInputTokens: toNumber(row.cacheCreationInputTokens),
      cacheReadInputTokens: toNumber(row.cacheReadInputTokens),
      cacheCreationInputCostUsd: toNumber(row.cacheCreationInputCostUsd),
      cacheReadInputCostUsd: toNumber(row.cacheReadInputCostUsd),
    }));
  }),

  getProjectRollups: publicProcedure
    .input(filtersWithLimitSchema)
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 200;
      const filters = {
        projectId: input.projectId,
        threadId: input.threadId,
        userId: input.userId,
        from: input.from,
        to: input.to,
        providerId: input.providerId,
        modelKey: input.modelKey,
        modelId: input.modelId,
        actionType: input.actionType,
        source: input.source,
        status: input.status,
      };

      const where = buildWhereInput(filters);

      const rows = await ctx.prisma.aiCall.groupBy({
        by: ["projectId"],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true, costUsd: true },
        orderBy: {
          _sum: { costUsd: "desc" },
        },
        take: limit,
      });

      const projectIds = rows.map((row) => row.projectId);
      const projects = await ctx.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(projects.map((project) => [project.id, project.name]));

      return rows.map((row) => ({
        projectId: row.projectId,
        projectName: nameById.get(row.projectId) ?? row.projectId,
        callCount: row._count._all ?? 0,
        totalTokens: toNumber(row._sum.totalTokens),
        totalCostUsd: toNumber(row._sum.costUsd),
      }));
    }),

  getTopConsumers: publicProcedure
    .input(filtersWithLimitSchema)
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 10;
      const filters = {
        projectId: input.projectId,
        threadId: input.threadId,
        userId: input.userId,
        from: input.from,
        to: input.to,
        providerId: input.providerId,
        modelKey: input.modelKey,
        modelId: input.modelId,
        actionType: input.actionType,
        source: input.source,
        status: input.status,
      };

      const where = buildWhereClause(filters);
      const whereWithThreads = buildWhereClause(filters, [
        Prisma.sql`"threadId" IS NOT NULL`,
      ]);

      const threads = await ctx.prisma.$queryRaw<
        Array<{
          threadId: string;
          callCount: number;
          totalTokens: number | null;
          costUsd: Prisma.Decimal | null;
        }>
      >(Prisma.sql`
        SELECT
          "threadId" AS "threadId",
          COUNT(*)::int AS "callCount",
          COALESCE(SUM("totalTokens"), 0) AS "totalTokens",
          COALESCE(SUM("costUsd"), 0) AS "costUsd"
        FROM "AiCall"
        ${whereWithThreads}
        GROUP BY "threadId"
        ORDER BY "costUsd" DESC
        LIMIT ${limit}
      `);

      const actions = await ctx.prisma.$queryRaw<
        Array<{
          actionType: string;
          callCount: number;
          totalTokens: number | null;
          costUsd: Prisma.Decimal | null;
        }>
      >(Prisma.sql`
        SELECT
          "actionType" AS "actionType",
          COUNT(*)::int AS "callCount",
          COALESCE(SUM("totalTokens"), 0) AS "totalTokens",
          COALESCE(SUM("costUsd"), 0) AS "costUsd"
        FROM "AiCall"
        ${where}
        GROUP BY "actionType"
        ORDER BY "costUsd" DESC
        LIMIT ${limit}
      `);

      const models = await ctx.prisma.$queryRaw<
        Array<{
          providerId: string;
          modelId: string | null;
          modelKey: string | null;
          callCount: number;
          totalTokens: number | null;
          costUsd: Prisma.Decimal | null;
        }>
      >(Prisma.sql`
        SELECT
          "providerId" AS "providerId",
          "modelId" AS "modelId",
          "modelKey" AS "modelKey",
          COUNT(*)::int AS "callCount",
          COALESCE(SUM("totalTokens"), 0) AS "totalTokens",
          COALESCE(SUM("costUsd"), 0) AS "costUsd"
        FROM "AiCall"
        ${where}
        GROUP BY "providerId", "modelId", "modelKey"
        ORDER BY "costUsd" DESC
        LIMIT ${limit}
      `);

      return {
        threads: threads.map((thread) => ({
          threadId: thread.threadId,
          callCount: thread.callCount,
          totalTokens: toNumber(thread.totalTokens),
          costUsd: toNumber(thread.costUsd),
        })),
        actions: actions.map((action) => ({
          actionType: action.actionType,
          callCount: action.callCount,
          totalTokens: toNumber(action.totalTokens),
          costUsd: toNumber(action.costUsd),
        })),
        models: models.map((model) => ({
          providerId: model.providerId,
          modelId: model.modelId,
          modelKey: model.modelKey,
          callCount: model.callCount,
          totalTokens: toNumber(model.totalTokens),
          costUsd: toNumber(model.costUsd),
        })),
      };
    }),
});
