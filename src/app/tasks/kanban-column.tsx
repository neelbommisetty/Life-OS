"use client";

import { useDrop } from "react-dnd";
import { cn } from "@/lib/utils";
import { TaskCard, type TaskWithProject } from "./task-card";
import type { TaskStatus } from "@prisma/client";

interface KanbanColumnProps {
  status: TaskStatus;
  title: string;
  tasks: TaskWithProject[];
  onDropTask: (taskId: string, newStatus: TaskStatus) => void;
  onEditTask: (task: TaskWithProject) => void;
  onDeleteTask: (task: TaskWithProject) => void;
}

const COLUMN_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/20",
  IN_PROGRESS: "bg-yellow-50/50 dark:bg-yellow-900/10 border-yellow-100 dark:border-yellow-900/20",
  DONE: "bg-green-50/50 dark:bg-green-900/10 border-green-100 dark:border-green-900/20",
};

export function KanbanColumn({
  status,
  title,
  tasks,
  onDropTask,
  onEditTask,
  onDeleteTask,
}: KanbanColumnProps) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: "TASK",
    drop: (item: { id: string; status: TaskStatus }) => {
      if (item.status !== status) {
        onDropTask(item.id, status);
      }
    },
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
    }),
  }));

  return (
    <div
      ref={drop}
      className={cn(
        "flex-1 min-w-[300px] rounded-lg border p-4 transition-colors",
        COLUMN_COLORS[status],
        isOver && "ring-2 ring-primary ring-inset"
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <span className="bg-background/80 text-muted-foreground text-xs font-medium px-2 py-1 rounded-full border">
          {tasks.length}
        </span>
      </div>

      <div className="space-y-3 min-h-[200px]">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onEdit={onEditTask}
            onDelete={onDeleteTask}
          />
        ))}
        {tasks.length === 0 && (
          <div className="h-24 border-2 border-dashed border-muted-foreground/20 rounded-lg flex items-center justify-center text-sm text-muted-foreground/50">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}
