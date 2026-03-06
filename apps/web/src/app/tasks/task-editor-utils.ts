import type { Priority, TaskStatus } from "@life-os/db";

const STATUS_META: Record<TaskStatus, { label: string; hint: string }> = {
  TODO: { label: "To do", hint: "Queued up" },
  IN_PROGRESS: { label: "In progress", hint: "Active now" },
  DONE: { label: "Done", hint: "Completed" },
};

const PRIORITY_META: Record<Priority, { label: string; hint: string }> = {
  LOW: { label: "Low", hint: "Can wait" },
  MEDIUM: { label: "Medium", hint: "Normal pace" },
  HIGH: { label: "High", hint: "Needs attention" },
};

export function getTaskEditorSummary({
  status,
  priority,
  dueDate,
}: {
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
}) {
  const selectedStatus = STATUS_META[status];
  const selectedPriority = PRIORITY_META[priority];
  const dueDateLabel = dueDate
    ? new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No deadline";

  return {
    selectedStatus,
    selectedPriority,
    dueDateLabel,
    summaryText: `${selectedStatus.hint}. ${selectedPriority.hint}. ${
      dueDate ? `Due ${dueDateLabel}.` : "Add a deadline if timing matters."
    }`,
  };
}
