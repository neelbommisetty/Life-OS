'use client';

import { TASK_KANBAN_STATUS_ORDER } from '@/lib/task-utils';

export function TaskBoardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
      {TASK_KANBAN_STATUS_ORDER.map((status) => (
        <div key={status} className="flex flex-col gap-3">
          {/* Column Header Skeleton */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-4 w-6 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
          </div>

          {/* Task Card Skeletons */}
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="space-y-3 rounded-xl border border-border bg-background p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-12 animate-pulse rounded-full bg-muted" />
                </div>

                <div className="space-y-2">
                  <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
                  <div className="h-3 w-5/6 animate-pulse rounded bg-muted/60" />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-12 animate-pulse rounded bg-muted/60" />
                    <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
