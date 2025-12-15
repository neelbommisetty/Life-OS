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
  IDEA: "bg-zinc-100 text-zinc-700 border-zinc-200",
  IN_PROGRESS: "bg-blue-100 text-blue-700 border-blue-200",
  MVP: "bg-purple-100 text-purple-700 border-purple-200",
  COMPLETE: "bg-emerald-100 text-emerald-700 border-emerald-200",
  ARCHIVE: "bg-slate-100 text-slate-700 border-slate-200",
  DEFER: "bg-amber-100 text-amber-700 border-amber-200",
  NOT_INTERESTED: "bg-rose-100 text-rose-700 border-rose-200",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: "bg-zinc-100 text-zinc-700 border-zinc-200",
  MEDIUM: "bg-blue-100 text-blue-700 border-blue-200",
  HIGH: "bg-amber-100 text-amber-700 border-amber-200",
  URGENT: "bg-rose-100 text-rose-700 border-rose-200",
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

