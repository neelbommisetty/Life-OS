import type { Task, TaskStatus } from '@prisma/client';
import { TASK_STATUS_ORDER, TASK_STATUS_LABELS } from '@/lib/task-utils';
import { PRIORITY_LABELS, formatDate } from '@/lib/project-utils';
import type { TaskDraft } from './task-board/types';

export function createEmptyDraft(defaultStatus: TaskStatus = 'BACKLOG'): TaskDraft {
  return {
    mode: 'create',
    title: '',
    description: '',
    status: defaultStatus,
    priority: 'MEDIUM',
    dueDate: '',
  };
}

export function toDateInput(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function reorderTasks(
  tasks: Task[],
  taskId: string,
  targetStatus: TaskStatus,
  position: number
) {
  const activeTask = tasks.find((task) => task.id === taskId);
  if (!activeTask) return tasks;

  const columns: Record<TaskStatus, Task[]> = {
    BACKLOG: [],
    TODO: [],
    IN_PROGRESS: [],
    DONE: [],
    ARCHIVED: [],
  };

  [...tasks].sort((a, b) => a.sortOrder - b.sortOrder).forEach((task) => {
    if (task.id === taskId) return;
    columns[task.status].push(task);
  });

  const insertIndex = Math.min(position, columns[targetStatus].length);
  columns[targetStatus].splice(insertIndex, 0, { ...activeTask, status: targetStatus });

  const nextTasks: Task[] = [];
  TASK_STATUS_ORDER.forEach((status) => {
    columns[status].forEach((task, index) => {
      nextTasks.push({ ...task, status, sortOrder: index + 1 });
    });
  });

  return nextTasks;
}

export function buildTaskThreadName(task: Task) {
  const prefix = buildTaskThreadPrefix(task.id);
  return `${prefix}${task.title}`.slice(0, 120);
}

export function buildTaskThreadPrefix(taskId: string) {
  return `Task:${taskId}::`;
}

export function findTaskThreadId(
  threads: Array<{ id: string; name: string }>,
  taskId: string
) {
  const prefix = buildTaskThreadPrefix(taskId);
  return threads.find((thread) => thread.name.startsWith(prefix))?.id ?? null;
}

export function buildTaskMessageTemplate(task: Task) {
  const details = [
    `Task: ${task.title}`,
    task.description ? `Description: ${task.description}` : null,
    `Status: ${TASK_STATUS_LABELS[task.status]}`,
    `Priority: ${PRIORITY_LABELS[task.priority]}`,
    task.dueDate ? `Due date: ${formatDate(task.dueDate)}` : null,
  ].filter(Boolean);

  return [
    "Brainstorm this task:",
    ...details,
    "",
    "Suggested focus:",
    "- Goal and success criteria",
    "- Approach and key steps",
    "- Dependencies or blockers",
    "- Risks and mitigations",
    "- Acceptance checklist",
  ].join("\n");
}
