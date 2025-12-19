import type { TaskStatus } from "@prisma/client";

export const TASK_STATUS_ORDER: TaskStatus[] = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "WAITING",
  "DONE",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  WAITING: "Waiting",
  DONE: "Done",
};

export const TASK_STATUS_TONES: Record<TaskStatus, string> = {
  BACKLOG:
    "border-slate-200/80 bg-slate-50 text-slate-800 dark:border-slate-800/70 dark:bg-slate-900/40 dark:text-slate-100",
  TODO:
    "border-emerald-200/80 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-100",
  IN_PROGRESS:
    "border-blue-200/80 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-100",
  WAITING:
    "border-amber-200/80 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100",
  DONE:
    "border-emerald-200/80 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/15 dark:text-emerald-100",
};
