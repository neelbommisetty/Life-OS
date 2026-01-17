export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 shrink-0 animate-pulse rounded-xl bg-muted" />
            <div className="space-y-2">
              <div className="h-8 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="flex gap-2 pt-1">
                <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
                <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
          </div>
          <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="border-t border-border pt-4">
          <div className="flex gap-4">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>

      {/* Tabs Skeleton */}
      <div>
        <div className="mb-6 flex gap-4 border-b border-border pb-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-6 w-20 animate-pulse rounded bg-muted" />
          ))}
        </div>

        {/* Tab Content Skeleton */}
        <div className="space-y-6 rounded-xl border border-border bg-card p-6">
          <div className="space-y-2">
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-20 animate-pulse rounded-lg bg-muted" />
            <div className="h-20 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    </main>
  );
}

