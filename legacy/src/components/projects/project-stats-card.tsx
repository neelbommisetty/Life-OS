"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { getProjectTheme } from "@/lib/project-theme";

type Props = {
  stats: {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
  };
  accentColor?: string | null;
};

export function ProjectStatsCard({ stats, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const hasColor = !!accentColor;
  const completionRate = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  // Progress ring constants
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (completionRate / 100) * circumference;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-6">
        <div className="space-y-4 flex-1">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Overall Progress
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-foreground">
                {completionRate}%
              </span>
              <span className="text-xs text-muted-foreground">
                completed
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase text-muted-foreground">To Do</p>
              <p className="text-sm font-semibold">{stats.todo}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase text-muted-foreground">Active</p>
              <p className="text-sm font-semibold">{stats.inProgress}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] uppercase text-muted-foreground">Done</p>
              <p className="text-sm font-semibold">{stats.done}</p>
            </div>
          </div>
        </div>

        <div className="relative flex h-24 w-24 shrink-0 items-center justify-center" style={themeStyle}>
          <svg className="h-full w-full -rotate-90">
            {/* Background circle */}
            <circle
              cx="48"
              cy="48"
              r={radius}
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              className="text-muted/20"
            />
            {/* Progress circle */}
            <motion.circle
              cx="48"
              cy="48"
              r={radius}
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1, ease: "easeOut" }}
              className={cn(
                hasColor ? "text-[rgb(var(--project-accent))]" : "text-primary"
              )}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
             <span className="text-[10px] font-bold text-muted-foreground uppercase">
               {stats.done}/{stats.total}
             </span>
          </div>
        </div>
      </div>
    </div>
  );
}
