import { Calendar, Plus } from "lucide-react";
import type { Task, TaskStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { TASK_STATUS_LABELS, TASK_STATUS_TONES } from "@/lib/task-utils";
import { PRIORITY_LABELS, formatDate } from "@/lib/project-utils";
import type { TaskListAction } from "./types";

export type TaskListItemProps = {
  task: Task;
  onSelect: () => void;
  onToggle?: () => void;
  isSelected?: boolean;
  actions: TaskListAction[];
};

export function TaskListItem({
  task,
  onSelect,
  onToggle,
  isSelected,
  actions,
}: TaskListItemProps) {
  return (
    <article
      onClick={(e) => {
        if (onToggle && (e.metaKey || e.ctrlKey)) {
          e.stopPropagation();
          onToggle();
        } else {
          onSelect();
        }
      }}
      className={cn(
        "group rounded-lg border border-border bg-background p-3 text-left shadow-sm transition-all hover:border-primary/40",
        isSelected &&
          "border-primary/60 ring-1 ring-primary/20 bg-primary/[0.02]"
      )}
    >
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
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-foreground">
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.dueDate && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              action.onClick();
            }}
            disabled={action.disabled}
            className={cn(
              "rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {action.label}
          </button>
        ))}
      </div>
    </article>
  );
}

export type BacklogListProps = {
  tasks: Task[];
  onAdd: () => void;
  onSelect: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
  onBrainstorm: (task: Task) => void;
  creatingThreadId: string | null;
  selectedTaskId: string | null;
  selectedTaskIds: Set<string>;
  onToggleSelection: (taskId: string) => void;
};

export function BacklogList({
  tasks,
  onAdd,
  onSelect,
  onMove,
  onBrainstorm,
  creatingThreadId,
  selectedTaskId,
  selectedTaskIds,
  onToggleSelection,
}: BacklogListProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {TASK_STATUS_LABELS.BACKLOG}
          </p>
          <p className="text-xs text-muted-foreground">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={onAdd}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-2">
        {tasks.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            No backlog tasks yet.
          </p>
        ) : (
          tasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              onSelect={() => onSelect(task)}
              onToggle={() => onToggleSelection(task.id)}
              isSelected={
                selectedTaskId === task.id || selectedTaskIds.has(task.id)
              }
              actions={[
                {
                  label: "Brainstorm",
                  onClick: () => onBrainstorm(task),
                  disabled: creatingThreadId === task.id,
                },
                {
                  label: "Move to To Do",
                  onClick: () => onMove(task, "TODO"),
                },
                {
                  label: "Archive",
                  onClick: () => onMove(task, "ARCHIVED"),
                },
              ]}
            />
          ))
        )}
      </div>
    </div>
  );
}

export type ArchivedListProps = {
  tasks: Task[];
  onSelect: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
  onBrainstorm: (task: Task) => void;
  creatingThreadId: string | null;
  selectedTaskId: string | null;
  selectedTaskIds: Set<string>;
  onToggleSelection: (taskId: string) => void;
};

export function ArchivedList({
  tasks,
  onSelect,
  onMove,
  onBrainstorm,
  creatingThreadId,
  selectedTaskId,
  selectedTaskIds,
  onToggleSelection,
}: ArchivedListProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {TASK_STATUS_LABELS.ARCHIVED}
          </p>
          <p className="text-xs text-muted-foreground">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-2">
        {tasks.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            No archived tasks.
          </p>
        ) : (
          tasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              onSelect={() => onSelect(task)}
              onToggle={() => onToggleSelection(task.id)}
              isSelected={
                selectedTaskId === task.id || selectedTaskIds.has(task.id)
              }
              actions={[
                {
                  label: "Brainstorm",
                  onClick: () => onBrainstorm(task),
                  disabled: creatingThreadId === task.id,
                },
                {
                  label: "Move to Backlog",
                  onClick: () => onMove(task, "BACKLOG"),
                },
                {
                  label: "Move to To Do",
                  onClick: () => onMove(task, "TODO"),
                },
              ]}
            />
          ))
        )}
      </div>
    </div>
  );
}
