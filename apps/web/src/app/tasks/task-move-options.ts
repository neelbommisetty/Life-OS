import type { TaskStatus } from "@life-os/db";

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

export function getTaskMoveOptions(status: TaskStatus) {
  return (Object.entries(TASK_STATUS_LABELS) as Array<[TaskStatus, string]>)
    .filter(([nextStatus]) => nextStatus !== status)
    .map(([nextStatus, label]) => ({
      status: nextStatus,
      label: `Move to ${label}`,
    }));
}
