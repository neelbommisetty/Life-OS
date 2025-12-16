import type { Priority, ProjectStatus } from "@prisma/client";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  IDEA: "Idea",
  IN_PROGRESS: "In Progress",
  MVP: "MVP",
  COMPLETE: "Complete",
  ARCHIVE: "Archived",
  DEFER: "Deferred",
  NOT_INTERESTED: "Not Interested",
};

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  IDEA: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-200 dark:border-zinc-800",
  IN_PROGRESS:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800",
  MVP: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-200 dark:border-purple-800",
  COMPLETE:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-200 dark:border-emerald-800",
  ARCHIVE:
    "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/35 dark:text-slate-200 dark:border-slate-800",
  DEFER: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800",
  NOT_INTERESTED:
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-800",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-200 dark:border-zinc-800",
  MEDIUM:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800",
  HIGH:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800",
  URGENT:
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-800",
};

export const formatDate = (date?: Date | string | null) => {
  if (!date) return "";
  const value = typeof date === "string" ? new Date(date) : date;
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

