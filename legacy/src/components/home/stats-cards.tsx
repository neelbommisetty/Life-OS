'use client';

import { Layers, Play, Lightbulb, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

type Props = {
  stats: {
    total: number;
    byStatus: {
      IDEA: number;
      IN_PROGRESS: number;
      COMPLETE: number;
    };
  };
};

export function StatsCards({ stats }: Props) {
  const completionRate = stats.total > 0
    ? Math.round((stats.byStatus.COMPLETE / stats.total) * 100)
    : 0;

  const [dashOffset, setDashOffset] = useState(113);

  useEffect(() => {
    // Animate progress circle after mount
    const target = 113 - (113 * completionRate) / 100;
    const timer = setTimeout(() => {
      setDashOffset(target);
    }, 500); // 0.5s delay
    return () => clearTimeout(timer);
  }, [completionRate]);

  const items = [
    {
      label: 'Total Projects',
      value: stats.total,
      icon: Layers,
      color: 'text-foreground',
      bg: 'bg-muted/50',
    },
    {
      label: 'In Progress',
      value: stats.byStatus.IN_PROGRESS,
      icon: Play,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-900/10',
    },
    {
      label: 'Ideas',
      value: stats.byStatus.IDEA,
      icon: Lightbulb,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-900/10',
    },
    {
      label: 'Completed',
      value: stats.byStatus.COMPLETE,
      icon: CheckCircle,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-900/10',
    },
  ];

  return (
    <div className="space-y-6">
      <div
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        {items.map((stat, i) => (
          <div
            key={stat.label}
            className={cn(
              "flex flex-col rounded-xl border border-border p-4 transition-colors opacity-0 animate-slide-up",
              stat.bg
            )}
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex items-center gap-2">
              <stat.icon className={cn("h-4 w-4", stat.color)} />
              <p className="text-xs font-medium text-muted-foreground">
                {stat.label}
              </p>
            </div>
            <p className={cn("mt-2 text-2xl font-bold", stat.color)}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {stats.total > 0 && (
        <div
          className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm opacity-0 animate-scale-in"
          style={{ animationDelay: '500ms' }}
        >
          <div className="flex items-center gap-4">
            <div className="relative h-12 w-12 flex-shrink-0">
              <svg className="h-12 w-12">
                <circle
                  className="text-muted stroke-current"
                  strokeWidth="4"
                  fill="transparent"
                  r="18"
                  cx="24"
                  cy="24"
                />
                <circle
                  className="text-emerald-500 stroke-current transition-all duration-1000 ease-out"
                  strokeWidth="4"
                  strokeDasharray={113}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  fill="transparent"
                  r="18"
                  cx="24"
                  cy="24"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                {completionRate}%
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Overall Completion</p>
              <p className="text-xs text-muted-foreground">You have completed {stats.byStatus.COMPLETE} out of {stats.total} total projects.</p>
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</p>
            <p className="text-sm font-bold text-emerald-500">
              {completionRate === 100 ? 'All finished!' : completionRate > 50 ? 'Getting there!' : 'Early stages'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
