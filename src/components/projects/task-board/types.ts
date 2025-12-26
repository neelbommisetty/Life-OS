import type { Priority, Task, TaskStatus } from '@prisma/client';

export type TaskDraft = {
  id?: string;
  mode: 'create' | 'edit';
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
};

export type TaskView = 'KANBAN' | 'BACKLOG' | 'ARCHIVED';

export type TaskListAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};
