import type { Task } from "../../../packages/tools/src/contract.ts";
export const isOpen = (task: Task) =>
  !task.deletedAt &&
  ["accepted", "in_progress", "proposed"].includes(task.status);
export const isCommitted = (task: Task) =>
  isOpen(task) && task.status !== "proposed";
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00");
  value.setDate(value.getDate() + days);
  return localDate(value);
}
export function dateLabel(date: string, today = localDate()) {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
  });
}
export type View =
  | "today"
  | "inbox"
  | "upcoming"
  | "all"
  | "completed"
  | "trash"
  | "search"
  | "labels"
  | "proposed"
  | `project:${string}`
  | `label:${string}`
  | `filter:${string}`;
export type Sort = "default" | "priority" | "date" | "name";
export function sortTasks(tasks: Task[], sort: Sort) {
  return [...tasks].sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title);
    if (sort === "priority")
      return (a.priority ?? 4) - (b.priority ?? 4) || a.order - b.order;
    if (sort === "date")
      return (
        (a.due?.date ?? "9999").localeCompare(b.due?.date ?? "9999") ||
        a.order - b.order
      );
    return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
  });
}
export function baseTasks(
  tasks: Task[],
  view: View,
  today: string,
  inbox?: string,
): Task[] {
  if (view === "trash") return tasks.filter((t) => !!t.deletedAt);
  if (view === "completed")
    return tasks.filter((t) => !t.deletedAt && t.status === "done");
  const open = tasks.filter(isOpen);
  if (view === "today")
    return open.filter((t) => isCommitted(t) && !!t.due && t.due.date <= today);
  if (view === "upcoming") return open.filter((t) => isCommitted(t) && !!t.due);
  if (view === "inbox") return open.filter((t) => t.projectId === inbox);
  if (view === "proposed") return open.filter((t) => t.status === "proposed");
  if (view.startsWith("project:"))
    return open.filter((t) => t.projectId === view.slice(8));
  return open;
}

/** Recurring completions are occurrences even when the task remains open. */
export function completedOn(tasks: Task[], date: string): number {
  return tasks
    .filter((task) => !task.deletedAt)
    .reduce((count, task) => {
      const occurrences = task.occurrences.filter(
        (item) => localDate(new Date(item.at)) === date,
      );
      const terminal =
        task.completedAt &&
        localDate(new Date(task.completedAt)) === date &&
        !occurrences.some((item) => item.at === task.completedAt)
          ? 1
          : 0;
      return count + occurrences.length + terminal;
    }, 0);
}
