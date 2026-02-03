import { redirect } from "next/navigation";
import { authServer } from "@/lib/auth/server";
import {
  getUsageSummary,
  getRecentAiCalls,
  type UsageSummary,
  type RecentAiCall,
} from "@life-os/ai/tracking";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";

/**
 * Format a number as USD currency
 */
function formatCurrency(amount: number): string {
  if (amount < 0.01 && amount > 0) {
    return `$${amount.toFixed(6)}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

/**
 * Format a large number with K/M suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

/**
 * Format call type to human-readable label
 */
function formatCallType(callType: string): string {
  const labels: Record<string, string> = {
    CHAT_STREAM: "Chat (Stream)",
    CHAT_BLOCKING: "Chat (Blocking)",
    SUMMARY_CALL: "Summary",
    TITLE_GEN_CALL: "Title Generation",
  };
  return labels[callType] ?? callType;
}

/**
 * Summary stats cards component
 */
function SummaryStats({ summary }: { summary: UsageSummary }) {
  const { totals } = summary;
  const avgCostPerCall =
    totals.totalCalls > 0 ? totals.totalCostUsd / totals.totalCalls : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card size="sm">
        <CardHeader>
          <CardDescription>Total Cost (30d)</CardDescription>
          <CardTitle className="text-2xl font-semibold">
            {formatCurrency(totals.totalCostUsd)}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardDescription>Total Calls</CardDescription>
          <CardTitle className="text-2xl font-semibold">
            {formatNumber(totals.totalCalls)}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardDescription>Total Tokens</CardDescription>
          <CardTitle className="text-2xl font-semibold">
            {formatNumber(totals.totalInputTokens + totals.totalOutputTokens)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {formatNumber(totals.totalInputTokens)} in /{" "}
          {formatNumber(totals.totalOutputTokens)} out
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardDescription>Avg Cost / Call</CardDescription>
          <CardTitle className="text-2xl font-semibold">
            {formatCurrency(avgCostPerCall)}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}

/**
 * Model breakdown table component
 */
function ModelBreakdown({ summary }: { summary: UsageSummary }) {
  if (summary.byModel.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage by Model</CardTitle>
          <CardDescription>
            No AI calls recorded yet. Start chatting to see usage breakdown.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage by Model</CardTitle>
        <CardDescription>Cost and token usage per AI model</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-3 font-medium">Model</th>
                <th className="pb-3 font-medium text-right">Calls</th>
                <th className="pb-3 font-medium text-right">Input</th>
                <th className="pb-3 font-medium text-right">Output</th>
                <th className="pb-3 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.byModel.map((model, i) => (
                <tr key={model.modelKey ?? `unknown-${i}`}>
                  <td className="py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {model.modelKey ?? "Unknown"}
                    </code>
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {model.callCount.toLocaleString()}
                  </td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {formatNumber(model.inputTokens)}
                  </td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {formatNumber(model.outputTokens)}
                  </td>
                  <td className="py-3 text-right tabular-nums font-medium">
                    {formatCurrency(model.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Thread attribution table component
 */
function ThreadAttribution({ summary }: { summary: UsageSummary }) {
  if (summary.byThread.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Threads by Cost</CardTitle>
        <CardDescription>
          Most expensive conversation threads in the last 30 days
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {summary.byThread.map((thread) => (
            <div
              key={thread.threadId}
              className="flex items-center justify-between"
            >
              <div className="flex-1 truncate">
                <span className="font-medium">
                  {thread.threadName ?? "Unnamed thread"}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {thread.callCount} calls
                </span>
              </div>
              <span className="ml-4 tabular-nums font-medium">
                {formatCurrency(thread.costUsd)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Call type breakdown component
 */
function CallTypeBreakdown({ summary }: { summary: UsageSummary }) {
  if (summary.byCallType.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage by Type</CardTitle>
        <CardDescription>Breakdown by AI call type</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {summary.byCallType.map((type) => (
            <div
              key={type.callType}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{formatCallType(type.callType)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {type.callCount} calls
                </span>
              </div>
              <span className="tabular-nums font-medium">
                {formatCurrency(type.costUsd)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Recent activity component
 */
function RecentActivity({ calls }: { calls: RecentAiCall[] }) {
  if (calls.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>
            No AI calls recorded yet. Start chatting to see activity.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest AI calls</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {calls.slice(0, 10).map((call) => (
            <div
              key={call.id}
              className="flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={call.status === "SUCCESS" ? "secondary" : "destructive"}
                  >
                    {formatCallType(call.callType)}
                  </Badge>
                  {call.modelKey && (
                    <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                      {call.modelKey}
                    </code>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {call.threadName && (
                    <span className="mr-2">{call.threadName}</span>
                  )}
                  {call.totalLatencyMs && (
                    <span className="mr-2">{call.totalLatencyMs}ms</span>
                  )}
                  <span>{formatRelativeTime(call.requestStartAt)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="tabular-nums font-medium">
                  {formatCurrency(call.costUsd)}
                </div>
                {(call.inputTokens || call.outputTokens) && (
                  <div className="text-xs text-muted-foreground">
                    {formatNumber(call.inputTokens ?? 0)} /{" "}
                    {formatNumber(call.outputTokens ?? 0)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function AnalyticsPage() {
  // Authenticate user
  const { data: session } = await authServer.getSession();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }
  const userId = session.user.id;

  // Fetch analytics data
  const [summary, recentCalls] = await Promise.all([
    getUsageSummary(userId, 30),
    getRecentAiCalls(userId, 10),
  ]);

  return (
    <div className="container mx-auto max-w-6xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">AI Usage Analytics</h1>
        <p className="text-muted-foreground">
          Track your AI usage, costs, and performance over the last 30 days.
        </p>
      </div>

      <SummaryStats summary={summary} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ModelBreakdown summary={summary} />
        <div className="space-y-6">
          <CallTypeBreakdown summary={summary} />
          <ThreadAttribution summary={summary} />
        </div>
      </div>

      <RecentActivity calls={recentCalls} />
    </div>
  );
}
