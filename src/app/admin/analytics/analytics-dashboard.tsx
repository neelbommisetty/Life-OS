"use client";

import { useEffect, useMemo, useState } from "react";
import { Filter, RefreshCw } from "lucide-react";
import { api } from "@/trpc/client";

type PricingInfo = {
  inputUsdPer1m: number;
  outputUsdPer1m: number;
  cacheCreationInputUsdPer1m?: number;
  cacheReadInputUsdPer1m?: number;
};

type PriceSnapshot = Partial<PricingInfo> & {
  inputUsdPer1m?: number | null;
  outputUsdPer1m?: number | null;
  cacheCreationInputUsdPer1m?: number | null;
  cacheReadInputUsdPer1m?: number | null;
};

type AnalyticsProject = {
  id: string;
  name: string;
};

type AnalyticsModel = {
  key: string;
  label: string;
  providerId: string;
  modelId?: string | null;
  pricing?: PricingInfo | null;
};

type AnalyticsDashboardProps = {
  projects: AnalyticsProject[];
  models: AnalyticsModel[];
};

type CostBreakdown = {
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  cacheReadCostUsd: number | null;
  cacheWriteCostUsd: number | null;
};

const formatNumber = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return new Intl.NumberFormat("en-US").format(value);
};

const formatUsd = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `$${value.toFixed(4)}`;
};

const formatTps = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(1);
};

const formatLatency = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${Math.round(value)}ms`;
};

const getSnapshot = (value: unknown): PriceSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as PriceSnapshot;
};

const getCostBreakdown = (call: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputCostUsd?: number | null;
  cacheReadInputCostUsd?: number | null;
  priceSnapshot?: unknown;
}): CostBreakdown => {
  const snapshot = getSnapshot(call.priceSnapshot);
  const inputRate = snapshot?.inputUsdPer1m ?? null;
  const outputRate = snapshot?.outputUsdPer1m ?? null;
  const cacheWriteRate = snapshot?.cacheCreationInputUsdPer1m ?? inputRate;
  const cacheReadRate = snapshot?.cacheReadInputUsdPer1m ?? inputRate;

  const inputTokens = call.inputTokens ?? 0;
  const outputTokens = call.outputTokens ?? 0;
  const cacheWriteTokens = call.cacheCreationInputTokens ?? 0;
  const cacheReadTokens = call.cacheReadInputTokens ?? 0;
  const nonCachedTokens = Math.max(
    inputTokens - cacheWriteTokens - cacheReadTokens,
    0
  );

  const inputCostUsd =
    inputRate !== null ? (nonCachedTokens / 1_000_000) * inputRate : null;
  const outputCostUsd =
    outputRate !== null ? (outputTokens / 1_000_000) * outputRate : null;
  const cacheWriteCostUsd =
    call.cacheCreationInputCostUsd ??
    (cacheWriteRate !== null
      ? (cacheWriteTokens / 1_000_000) * cacheWriteRate
      : null);
  const cacheReadCostUsd =
    call.cacheReadInputCostUsd ??
    (cacheReadRate !== null
      ? (cacheReadTokens / 1_000_000) * cacheReadRate
      : null);

  return {
    inputCostUsd,
    outputCostUsd,
    cacheReadCostUsd,
    cacheWriteCostUsd,
  };
};

const SummaryTile = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) => {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
};

export function AnalyticsDashboard({ projects, models }: AnalyticsDashboardProps) {
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "all">("30d");
  const [projectId, setProjectId] = useState<string>("all");
  const [providerId, setProviderId] = useState<string>("all");
  const [modelKey, setModelKey] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState<string>("");
  const [actionType, setActionType] = useState<string>("");
  const [threadId, setThreadId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const providerOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const model of models) {
      unique.add(model.providerId);
    }
    return Array.from(unique.values()).sort();
  }, [models]);

  const modelOptions = useMemo(() => {
    if (providerId === "all") {
      return models;
    }
    return models.filter((model) => model.providerId === providerId);
  }, [models, providerId]);

  useEffect(() => {
    if (modelKey === "all") {
      return;
    }
    const matches = modelOptions.some((model) => model.key === modelKey);
    if (!matches) {
      setModelKey("all");
    }
  }, [modelKey, modelOptions]);

  const range = useMemo(() => {
    if (timeRange === "all") {
      return { from: undefined, to: undefined };
    }
    const days = timeRange === "7d" ? 7 : 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from, to };
  }, [timeRange]);

  const scope =
    threadId.trim().length > 0
      ? "thread"
      : userId.trim().length > 0
      ? "user"
      : projectId !== "all"
      ? "project"
      : "global";

  const filterInput = {
    scope,
    projectId: projectId !== "all" ? projectId : undefined,
    threadId: threadId.trim() || undefined,
    userId: userId.trim() || undefined,
    from: range.from,
    to: range.to,
    providerId: providerId !== "all" ? providerId : undefined,
    modelKey: modelKey !== "all" ? modelKey : undefined,
    actionType: actionType.trim() || undefined,
    source: source.trim() || undefined,
    status: status !== "all" ? (status as "SUCCESS" | "ERROR" | "ABORTED") : undefined,
  };

  const rangeLabel =
    timeRange === "all"
      ? "All time"
      : timeRange === "7d"
      ? "Last 7 days"
      : "Last 30 days";

  const listFilters = {
    projectId: filterInput.projectId,
    threadId: filterInput.threadId,
    userId: filterInput.userId,
    providerId: filterInput.providerId,
    modelKey: filterInput.modelKey,
    actionType: filterInput.actionType,
    source: filterInput.source,
    status: filterInput.status,
    from: filterInput.from,
    to: filterInput.to,
    limit: 100,
  };

  const summaryQuery = api.aiUsage.getSummary.useQuery(filterInput, {
    keepPreviousData: true,
  });

  const rollupsQuery = api.aiUsage.getProjectRollups.useQuery(
    { ...filterInput, limit: 200 },
    { keepPreviousData: true }
  );

  const callsQuery = api.aiUsage.listCalls.useQuery(listFilters, {
    keepPreviousData: true,
  });

  const summary = summaryQuery.data;
  const rollups = rollupsQuery.data ?? [];
  const calls = callsQuery.data ?? [];

  return (
    <section className="space-y-8">
      <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Filters</h2>
            <p className="text-sm text-muted-foreground">
              Tune the scope and slice the usage feed.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Filter className="h-4 w-4" />
            <span>{rangeLabel}</span>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Range
            <select
              value={timeRange}
              onChange={(event) =>
                setTimeRange(event.target.value as "7d" | "30d" | "all")
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Project
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Provider
            <select
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">All providers</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Model
            <select
              value={modelKey}
              onChange={(event) => setModelKey(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">All models</option>
              {modelOptions.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">All statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="ERROR">Error</option>
              <option value="ABORTED">Aborted</option>
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Source
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="chat, quick_action"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Action type
            <input
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
              placeholder="project_chat"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            User id
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="optional"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Thread id
            <input
              value={threadId}
              onChange={(event) => setThreadId(event.target.value)}
              placeholder="optional"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryTile
              label="Total calls"
              value={formatNumber(summary?.totalCalls)}
            />
            <SummaryTile
              label="Total tokens"
              value={formatNumber(summary?.totalTokens)}
              detail={`Input ${formatNumber(summary?.totalInputTokens)} | Output ${formatNumber(
                summary?.totalOutputTokens
              )}`}
            />
            <SummaryTile
              label="Total cost"
              value={formatUsd(summary?.totalCostUsd)}
              detail={`Cache read ${formatUsd(summary?.totalCacheReadInputCostUsd)} | Cache write ${formatUsd(
                summary?.totalCacheCreationInputCostUsd
              )}`}
            />
            <SummaryTile
              label="Avg tokens per call"
              value={formatNumber(summary?.avgTokensPerCall)}
              detail={`Median ${formatNumber(summary?.medianTokensPerCall)} | P95 ${formatNumber(
                summary?.p95TokensPerCall
              )}`}
            />
            <SummaryTile
              label="Avg streaming TPS"
              value={formatTps(summary?.avgStreamingTps)}
              detail={`Max ${formatTps(summary?.maxStreamingTps)}`}
            />
            <SummaryTile
              label="Avg cost per call"
              value={formatUsd(summary?.avgCostPerCall)}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Project totals
              </div>
              <div className="text-lg font-semibold text-foreground">Projects</div>
            </div>
            <button
              type="button"
              onClick={() => rollupsQuery.refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
          <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Calls</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rollups.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-sm text-muted-foreground" colSpan={3}>
                      No usage records yet.
                    </td>
                  </tr>
                )}
                {rollups.map((rollup) => (
                  <tr key={rollup.projectId} className="text-sm">
                    <td className="px-3 py-2 text-foreground">{rollup.projectName}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatNumber(rollup.callCount)}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground">
                      {formatUsd(rollup.totalCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI calls
            </div>
            <div className="text-lg font-semibold text-foreground">
              Recent calls
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Showing {calls.length} calls
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Model</th>
                <th className="px-3 py-3">Project</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3 text-right">Input</th>
                <th className="px-3 py-3 text-right">Cache write</th>
                <th className="px-3 py-3 text-right">Cache read</th>
                <th className="px-3 py-3 text-right">TPS</th>
                <th className="px-3 py-3 text-right">Latency</th>
                <th className="px-3 py-3 text-right">Total cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {calls.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-sm text-muted-foreground" colSpan={9}>
                    No calls match these filters.
                  </td>
                </tr>
              )}
              {calls.map((call) => {
                const breakdown = getCostBreakdown(call);
                const latencyMs = call.totalLatencyMs ?? call.modelMs ?? null;
                return (
                  <tr key={call.id} className="hover:bg-muted/30">
                    <td className="px-3 py-3 text-sm text-foreground">
                      <div className="font-medium">
                        {call.modelKey ?? call.modelId ?? "unknown"}
                      </div>
                      <div className="text-xs text-muted-foreground">{call.providerId}</div>
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {call.project?.name ?? call.projectId}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      <div className="font-medium">{call.actionType}</div>
                      <div className="text-xs text-muted-foreground">{call.source}</div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-foreground">
                      {formatNumber(call.inputTokens)}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-foreground">
                      {formatNumber(call.cacheCreationInputTokens)}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-foreground">
                      {formatNumber(call.cacheReadInputTokens)}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-foreground">
                      {formatTps(call.streamingTps)}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-foreground">
                      {formatLatency(latencyMs)}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-foreground">
                      <div className="group relative inline-flex items-center justify-end">
                        <span className="font-semibold">{formatUsd(call.costUsd)}</span>
                        <div className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-48 rounded-lg border border-border bg-card p-2 text-xs text-muted-foreground shadow-lg opacity-0 transition group-hover:opacity-100">
                          <div className="flex items-center justify-between">
                            <span>Input</span>
                            <span>{formatUsd(breakdown.inputCostUsd)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Output</span>
                            <span>{formatUsd(breakdown.outputCostUsd)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Cache read</span>
                            <span>{formatUsd(breakdown.cacheReadCostUsd)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Cache write</span>
                            <span>{formatUsd(breakdown.cacheWriteCostUsd)}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
