import { motion } from 'framer-motion';

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-12">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between animate-pulse">
        <div className="space-y-3">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-4 w-64 rounded bg-muted/60" />
        </div>
        <div className="h-4 w-24 rounded bg-muted" />
      </div>

      {/* Continue Card Skeleton */}
      <div className="h-48 w-full rounded-2xl bg-muted/30 animate-pulse" />

      {/* Quick Actions Skeleton */}
      <div className="space-y-4">
        <div className="h-3 w-24 rounded bg-muted/60 uppercase animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 animate-pulse text-zinc-400">
          <div className="h-20 rounded-xl bg-muted/40" />
          <div className="h-20 rounded-xl bg-muted/40" />
          <div className="h-20 rounded-xl bg-muted/40" />
        </div>
      </div>

      {/* Stats Grid Skeleton */}
      <div className="space-y-4">
        <div className="h-3 w-28 rounded bg-muted/60 uppercase animate-pulse" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/40" />
          ))}
        </div>
      </div>

      {/* Recent Activity Skeleton */}
      <div className="space-y-6">
        <div className="h-7 w-40 rounded bg-muted animate-pulse" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-muted/30" />
          ))}
        </div>
      </div>
    </div>
  );
}
