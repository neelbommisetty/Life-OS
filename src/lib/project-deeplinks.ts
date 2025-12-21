export const taskViewParams = ["kanban", "backlog", "archived"] as const;

export type TaskViewParam = (typeof taskViewParams)[number];

export function resolveTasksViewParam(value?: string | null): TaskViewParam {
  const normalized = value?.trim().toLowerCase() ?? "";
  return taskViewParams.includes(normalized as TaskViewParam)
    ? (normalized as TaskViewParam)
    : "kanban";
}
