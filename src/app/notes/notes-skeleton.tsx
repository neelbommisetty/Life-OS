import { Skeleton } from "@/components/ui/skeleton";

export function NotesSkeleton() {
  return (
    <div className="grid h-full grid-cols-[minmax(240px,300px)_1fr] overflow-hidden">
      {/* Sidebar Skeleton */}
      <div className="border-r border-border bg-muted/30 overflow-hidden h-full flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
          <div className="h-8 w-8 bg-muted animate-pulse rounded" />
        </div>
        <div className="px-3 py-2 border-b border-border/50 shrink-0">
          <div className="h-8 w-full bg-muted animate-pulse rounded" />
        </div>
        <div className="flex-1 p-2 space-y-4 overflow-hidden">
          <div className="space-y-2">
            <div className="h-3 w-20 bg-muted/50 animate-pulse rounded ml-2" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 w-full bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </div>
      </div>

      {/* Main Area Skeleton */}
      <div className="h-full overflow-hidden flex flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
          <div className="h-6 w-48 bg-muted animate-pulse rounded" />
          <div className="flex gap-2">
            <div className="h-8 w-20 bg-muted animate-pulse rounded" />
            <div className="h-8 w-8 bg-muted animate-pulse rounded" />
            <div className="h-8 w-16 bg-muted animate-pulse rounded" />
          </div>
        </div>
        <div className="flex-1 p-8 space-y-4">
          <div className="h-4 w-full bg-muted animate-pulse rounded" />
          <div className="h-4 w-[90%] bg-muted animate-pulse rounded" />
          <div className="h-4 w-[95%] bg-muted animate-pulse rounded" />
          <div className="h-4 w-[85%] bg-muted animate-pulse rounded" />
          <div className="h-4 w-[92%] bg-muted animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}
