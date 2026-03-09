import { Skeleton } from "@/components/ui/skeleton";

export function TasksSkeleton() {
  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div className="space-y-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-[200px]" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      {/* Kanban Board Skeleton */}
      <div className="flex flex-1 flex-col gap-6 overflow-x-auto pb-4 min-h-0 lg:flex-row">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex min-w-[260px] flex-1 flex-col gap-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
            <div className="flex-1 space-y-4">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
