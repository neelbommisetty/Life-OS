import { Calendar, MessageSquareIcon } from 'lucide-react';
import type { Task } from '@prisma/client';
import { cn } from '@/lib/utils';
import { TASK_STATUS_LABELS, TASK_STATUS_TONES } from '@/lib/task-utils';
import { PRIORITY_LABELS, formatDate } from '@/lib/project-utils';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
          {onBrainstorm && (
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
};

export function SortableTaskCard({
  task,
  onSelect,
  onBrainstorm,
  isBrainstorming,
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
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className={cn(
        "group cursor-grab rounded-lg border border-border bg-background p-3 text-left shadow-sm transition-colors hover:border-primary/40",
        isDragging && "opacity-0"
      )}
    >
      <TaskCardContent
        task={task}
        onBrainstorm={onBrainstorm}
        isBrainstorming={isBrainstorming}
      />
    </article>
  );
}

export type TaskCardProps = {
  task: Task;
  isOverlay?: boolean;
};

export function TaskCard({ task, isOverlay }: TaskCardProps) {
  return (
    <article
      className={cn(
        "group rounded-lg border border-border bg-background p-3 text-left shadow-sm",
        isOverlay ? "cursor-grabbing opacity-90 shadow-lg" : "cursor-grab"
      )}
    >
      <TaskCardContent task={task} />
    </article>
  );
}
