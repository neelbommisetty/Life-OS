import { Calendar, MessageSquareIcon } from 'lucide-react';
import type { Task } from '@prisma/client';
import { cn } from '@/lib/utils';
import { TASK_STATUS_LABELS, TASK_STATUS_TONES } from '@/lib/task-utils';
import { PRIORITY_LABELS, formatDate } from '@/lib/project-utils';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskContextMenu } from './task-context-menu';
import type { TaskStatus } from '@prisma/client';

export type TaskCardContentProps = {
  task: Task;
  onBrainstorm?: () => void;
  isBrainstorming?: boolean;
};

export function TaskCardContent({
  task,
  onBrainstorm,
  isBrainstorming,
}: TaskCardContentProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{task.title}</h4>
        <span
          className={cn(
            "rounded-full px-2 py-1 text-[10px] font-semibold",
            TASK_STATUS_TONES[task.status]
          )}
        >
          {TASK_STATUS_LABELS[task.status]}
        </span>
      </div>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {task.description}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-foreground">
          {PRIORITY_LABELS[task.priority]}
        </span>
        <div className="flex items-center gap-2">
          {task.dueDate && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(task.dueDate)}
            </span>
          )}
          {onBrainstorm && task.status !== 'DONE' && task.status !== 'ARCHIVED' && (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onBrainstorm();
              }}
              disabled={isBrainstorming}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-foreground transition hover:bg-muted",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              <MessageSquareIcon className="h-3 w-3" />
              {isBrainstorming ? "Starting..." : "Brainstorm"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export type SortableTaskCardProps = {
  task: Task;
  onSelect: () => void;
  onBrainstorm: () => void;
  isBrainstorming: boolean;
  isSelected?: boolean;
  onStatusChange: (status: TaskStatus) => void;
  onDelete: () => void;
  onToggle: () => void;
};

export function SortableTaskCard({
  task,
  onSelect,
  onBrainstorm,
  isBrainstorming,
  isSelected,
  onStatusChange,
  onDelete,
  onToggle,
}: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TaskContextMenu
      task={task}
      onStatusChange={onStatusChange}
      onEdit={onSelect}
      onDelete={onDelete}
    >
      <article
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.stopPropagation();
            onToggle();
          } else {
            onSelect();
          }
        }}
        className={cn(
          "group cursor-grab rounded-lg border border-border bg-background p-3 text-left shadow-sm transition-all hover:border-primary/40",
          isSelected && "border-primary/60 ring-1 ring-primary/20 bg-primary/[0.02]",
          isDragging && "opacity-0"
        )}
      >
        <TaskCardContent
          task={task}
          onBrainstorm={onBrainstorm}
          isBrainstorming={isBrainstorming}
        />
      </article>
    </TaskContextMenu>
  );
}

export type TaskCardProps = {
  task: Task;
  isOverlay?: boolean;
  isSelected?: boolean;
};

export function TaskCard({ task, isOverlay, isSelected }: TaskCardProps) {
  return (
    <article
      className={cn(
        "group rounded-lg border border-border bg-background p-3 text-left shadow-sm transition-all",
        isSelected && "border-primary/60 ring-1 ring-primary/20 bg-primary/[0.02]",
        isOverlay ? "cursor-grabbing opacity-90 shadow-2xl scale-105 rotate-2 ring-1 ring-primary/30" : "cursor-grab"
      )}
      style={isOverlay ? { transform: 'scale(1.05) rotate(2deg)' } : undefined}
    >
      <TaskCardContent task={task} />
    </article>
  );
}
