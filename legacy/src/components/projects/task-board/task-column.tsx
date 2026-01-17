import { Plus } from 'lucide-react';
import type { Task, TaskStatus } from '@prisma/client';
import { cn } from '@/lib/utils';
import { TASK_STATUS_LABELS } from '@/lib/task-utils';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTaskCard } from './task-card';

export type TaskColumnProps = {
  status: TaskStatus;
  tasks: Task[];
  onAdd: () => void;
  onSelect: (task: Task) => void;
  onBrainstorm: (task: Task) => void;
  creatingThreadId: string | null;
  selectedTaskId: string | null;
  selectedTaskIds: Set<string>;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onDelete: (task: Task) => void;
  onToggleSelection: (taskId: string) => void;
};

export function TaskColumn({
  status,
  tasks,
  onAdd,
  onSelect,
  onBrainstorm,
  creatingThreadId,
  selectedTaskId,
  selectedTaskIds,
  onStatusChange,
  onDelete,
  onToggleSelection,
}: TaskColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
  });

  return (
    <div
      ref={setNodeRef}
      className="flex h-full flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm"
      id={`column-${status}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{
            TASK_STATUS_LABELS[status]
          }</p>
          <p className="text-xs text-muted-foreground">{tasks.length} task{tasks.length === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={onAdd}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={cn(
            "flex min-h-32 flex-1 flex-col gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-2",
            isOver && "border-primary/50 bg-primary/5"
          )}
        >
          {tasks.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              Drop a task here
            </p>
          ) : (
            tasks.map((task) => (
               <SortableTaskCard
                key={task.id}
                task={task}
                onSelect={() => onSelect(task)}
                onBrainstorm={() => onBrainstorm(task)}
                isBrainstorming={creatingThreadId === task.id}
                isSelected={selectedTaskId === task.id || selectedTaskIds.has(task.id)}
                onStatusChange={(status) => onStatusChange(task, status)}
                onDelete={() => onDelete(task)}
                onToggle={() => onToggleSelection(task.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
