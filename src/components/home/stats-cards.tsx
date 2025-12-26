'use client';

import { motion } from 'framer-motion';
import { Layers, Play, Lightbulb, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

export function StatsCards({ stats }: Props) {
  const completionRate = stats.total > 0
    ? Math.round((stats.byStatus.COMPLETE / stats.total) * 100)
    : 0;

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
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        {items.map((stat) => (
          <motion.div
            key={stat.label}
            variants={item}
            className={cn(
              "flex flex-col rounded-xl border border-border p-4 transition-colors",
              stat.bg
            )}
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
          </motion.div>
        ))}
      </motion.div>

      {stats.total > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm"
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
                <motion.circle
                  className="text-emerald-500 stroke-current"
                  strokeWidth="4"
                  strokeDasharray={113}
                  initial={{ strokeDashoffset: 113 }}
                  animate={{ strokeDashoffset: 113 - (113 * completionRate) / 100 }}
                  transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
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
        </motion.div>
      )}
    </div>
  );
}
