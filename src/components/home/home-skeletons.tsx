import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";

export function RecentProjectsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-7 w-32 bg-secondary animate-pulse rounded" />
        <div className="h-8 w-16 bg-secondary animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="h-[180px]">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start mb-1">
                <div className="h-5 w-12 bg-secondary animate-pulse rounded" />
                <div className="h-8 w-8 bg-secondary animate-pulse rounded-full" />
              </div>
              <div className="h-6 w-3/4 bg-secondary animate-pulse rounded" />
              <div className="h-4 w-1/2 bg-secondary animate-pulse rounded mt-1" />
            </CardHeader>
            <CardContent>
              <div className="h-4 w-1/3 bg-secondary animate-pulse rounded" />
            </CardContent>
            <CardFooter className="pt-0">
              <div className="h-3 w-1/4 bg-secondary animate-pulse rounded" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function UpcomingTasksSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-7 w-36 bg-secondary animate-pulse rounded" />
        <div className="h-9 w-9 bg-secondary animate-pulse rounded" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 flex items-center gap-4">
            <div className="h-5 w-5 bg-secondary animate-pulse rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 bg-secondary animate-pulse rounded" />
              <div className="h-3 w-1/3 bg-secondary animate-pulse rounded" />
            </div>
            <div className="h-5 w-12 bg-secondary animate-pulse rounded" />
          </Card>
        ))}
        <div className="h-10 w-full bg-secondary animate-pulse rounded mt-2" />
      </div>
    </div>
  );
}

export function RecentNotesSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-7 w-28 bg-secondary animate-pulse rounded" />
        <div className="h-9 w-9 bg-secondary animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <Card key={i} className="p-4 space-y-3 h-[140px]">
            <div className="h-8 w-8 bg-secondary animate-pulse rounded-lg" />
            <div className="space-y-2">
              <div className="h-5 w-3/4 bg-secondary animate-pulse rounded" />
              <div className="h-4 w-full bg-secondary animate-pulse rounded" />
            </div>
            <div className="h-3 w-1/4 bg-secondary animate-pulse rounded pt-2" />
          </Card>
        ))}
        <div className="h-[140px] border border-dashed rounded-lg bg-secondary/5 animate-pulse" />
      </div>
    </div>
  );
}
