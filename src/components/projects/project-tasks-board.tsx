'use client';

import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import { useCallback, useMemo, useState, Fragment } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Priority, Task, TaskStatus } from '@prisma/client';
import { Calendar, Filter, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '@/trpc/client';
import {
  TASK_KANBAN_STATUS_ORDER,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_STATUS_TONES,
} from '@/lib/task-utils';
import { PRIORITY_LABELS, formatDate } from '@/lib/project-utils';
import { priorityEnum } from '@/lib/validations/project';
import { taskStatusEnum } from '@/lib/validations/task';
import { cn } from '@/lib/utils';
import { getProjectTheme } from '@/lib/project-theme';
import { useDroppable } from '@dnd-kit/core';

type Props = {
  projectId: string;
  accentColor?: string | null;
};

type TaskDraft = {
  id?: string;
  mode: 'create' | 'edit';
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
};

type TaskView = 'KANBAN' | 'BACKLOG' | 'ARCHIVED';

const priorityOptions = priorityEnum.options as Priority[];
const statusOptions = taskStatusEnum.options as TaskStatus[];

export function ProjectTasksBoard({ projectId, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const utils = api.useUtils();
  const { data, isLoading } = api.task.list.useQuery({ projectId });
  const tasks = useMemo(() => data ?? [], [data]);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'ALL'>('ALL');
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => createEmptyDraft());
  const [activeView, setActiveView] = useState<TaskView>('KANBAN');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const syncTasks = useCallback(
    (next: Task[]) => {
      utils.task.list.setData({ projectId }, next);
    },
    [projectId, utils.task.list]
  );

  const createTask = api.task.create.useMutation({
    onSuccess: (created) => {
      const next = [...tasks, created];
      syncTasks(next);
      setPanelOpen(false);
    },
  });

  const updateTask = api.task.update.useMutation({
    onSuccess: (updated) => {
      const next = tasks.map((task) => (task.id === updated.id ? updated : task));
      syncTasks(next);
      setPanelOpen(false);
    },
  });

  const deleteTask = api.task.delete.useMutation({
    onSuccess: (_, variables) => {
      const next = tasks.filter((task) => task.id !== variables.id);
      syncTasks(next);
      setPanelOpen(false);
    },
  });

  const moveTask = api.task.move.useMutation({
    onSuccess: (next) => {
      syncTasks(next);
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    })
  );

  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return rectIntersection(args);
  };

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesPriority = priorityFilter === 'ALL' || task.priority === priorityFilter;
      const matchesSearch =
        !query ||
        task.title.toLowerCase().includes(query) ||
        (task.description ?? '').toLowerCase().includes(query);
      return matchesPriority && matchesSearch;
    });
  }, [priorityFilter, search, tasks]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      BACKLOG: [],
      TODO: [],
      IN_PROGRESS: [],
      DONE: [],
      ARCHIVED: [],
    };

    visibleTasks.forEach((task) => {
      grouped[task.status]?.push(task);
    });

    TASK_STATUS_ORDER.forEach((status) => {
      grouped[status] = grouped[status].sort((a, b) => a.sortOrder - b.sortOrder);
    });

    return grouped;
  }, [visibleTasks]);

  const backlogTasks = tasksByStatus.BACKLOG ?? [];
  const archivedTasks = tasksByStatus.ARCHIVED ?? [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTaskId(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeTask = tasks.find((task) => task.id === activeId);
    if (!activeTask) return;

    let targetStatus: TaskStatus = activeTask.status;
    let targetIndex = 0;

    if (overId.startsWith('column-')) {
      const status = overId.replace('column-', '') as TaskStatus;
      targetStatus = status;
      targetIndex = tasksByStatus[status]?.length ?? 0;
    } else {
      const overTask = tasks.find((task) => task.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      targetIndex = tasksByStatus[targetStatus]?.findIndex((task) => task.id === overId) ?? 0;
    }

    const nextTasks = reorderTasks(tasks, activeId, targetStatus, targetIndex);
    syncTasks(nextTasks);

    moveTask.mutate({
      id: activeId,
      projectId,
      status: targetStatus,
      position: targetIndex,
    });
  };

  const handleDragStart = (event: { active: { id: string } }) => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragCancel = () => {
    setActiveTaskId(null);
  };

  const activeTask = useMemo(
    () => (activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null),
    [activeTaskId, tasks]
  );

  const openCreatePanel = (status: TaskStatus) => {
    setDraft(createEmptyDraft(status));
    setPanelOpen(true);
  };

  const openEditPanel = (task: Task) => {
    setDraft({
      id: task.id,
      mode: 'edit',
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ? toDateInput(task.dueDate) : '',
    });
    setPanelOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const dueDateValue = draft.dueDate
      ? new Date(draft.dueDate).toISOString()
      : draft.mode === 'edit'
        ? null
        : undefined;

    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim() ? draft.description.trim() : undefined,
      status: draft.status,
      priority: draft.priority,
      dueDate: dueDateValue,
    };

    if (draft.mode === 'create') {
      await createTask.mutateAsync({
        ...payload,
        projectId,
      });
    } else if (draft.id) {
      await updateTask.mutateAsync({
        ...payload,
        id: draft.id,
      });
    }
  };

  const handleDelete = () => {
    if (!draft.id) return;
    deleteTask.mutate({ id: draft.id });
  };

  const handleQuickStatusChange = (task: Task, status: TaskStatus) => {
    const nextTasks = tasks.map((item) =>
      item.id === task.id ? { ...item, status } : item
    );
    syncTasks(nextTasks);
    updateTask.mutate({
      id: task.id,
      status,
    });
  };

  return (
    <section className="space-y-4" style={themeStyle}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-full rounded-lg border border-border bg-background px-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-foreground">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | 'ALL')}
              className="bg-transparent text-sm focus:outline-none"
            >
              <option value="ALL">All priorities</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1 text-xs font-semibold text-foreground">
            <button
              onClick={() => setActiveView('KANBAN')}
              className={cn(
                "rounded-md px-3 py-1 transition-colors",
                activeView === 'KANBAN'
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Board
            </button>
            <button
              onClick={() => setActiveView('BACKLOG')}
              className={cn(
                "rounded-md px-3 py-1 transition-colors",
                activeView === 'BACKLOG'
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Backlog
            </button>
            <button
              onClick={() => setActiveView('ARCHIVED')}
              className={cn(
                "rounded-md px-3 py-1 transition-colors",
                activeView === 'ARCHIVED'
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Archived
            </button>
          </div>
          <button
            onClick={() => openCreatePanel('BACKLOG')}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New task
          </button>
        </div>
      </div>

      {activeView === 'KANBAN' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <div className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
            {TASK_KANBAN_STATUS_ORDER.map((status) => (
              <TaskColumn
                key={status}
                status={status}
                tasks={tasksByStatus[status] ?? []}
                onAdd={() => openCreatePanel(status)}
                onSelect={openEditPanel}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
          </DragOverlay>
        </DndContext>
      ) : activeView === 'BACKLOG' ? (
        <BacklogList
          tasks={backlogTasks}
          onAdd={() => openCreatePanel('BACKLOG')}
          onSelect={openEditPanel}
          onMove={(task, status) => handleQuickStatusChange(task, status)}
        />
      ) : (
        <ArchivedList
          tasks={archivedTasks}
          onSelect={openEditPanel}
          onMove={(task, status) => handleQuickStatusChange(task, status)}
        />
      )}

      <TaskPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        draft={draft}
        setDraft={setDraft}
        onSave={handleSave}
        onDelete={handleDelete}
        isSaving={createTask.isPending || updateTask.isPending}
        isDeleting={deleteTask.isPending}
      />

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading tasks...</p>
      )}
    </section>
  );
}

type TaskColumnProps = {
  status: TaskStatus;
  tasks: Task[];
  onAdd: () => void;
  onSelect: (task: Task) => void;
};

type BacklogListProps = {
  tasks: Task[];
  onAdd: () => void;
  onSelect: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
};

function BacklogList({ tasks, onAdd, onSelect, onMove }: BacklogListProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {TASK_STATUS_LABELS.BACKLOG}
          </p>
          <p className="text-xs text-muted-foreground">
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
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
              actions={[
                {
                  label: "Move to To Do",
                  onClick: () => onMove(task, 'TODO'),
                },
                {
                  label: "Archive",
                  onClick: () => onMove(task, 'ARCHIVED'),
                },
              ]}
            />
          ))
        )}
      </div>
    </div>
  );
}

type ArchivedListProps = {
  tasks: Task[];
  onSelect: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
};

function ArchivedList({ tasks, onSelect, onMove }: ArchivedListProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {TASK_STATUS_LABELS.ARCHIVED}
          </p>
          <p className="text-xs text-muted-foreground">
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
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
              actions={[
                {
                  label: "Move to Backlog",
                  onClick: () => onMove(task, 'BACKLOG'),
                },
                {
                  label: "Move to To Do",
                  onClick: () => onMove(task, 'TODO'),
                },
              ]}
            />
          ))
        )}
      </div>
    </div>
  );
}

type TaskListAction = {
  label: string;
  onClick: () => void;
};

type TaskListItemProps = {
  task: Task;
  onSelect: () => void;
  actions: TaskListAction[];
};

function TaskListItem({ task, onSelect, actions }: TaskListItemProps) {
  return (
    <article
      onClick={onSelect}
      className="group rounded-lg border border-border bg-background p-3 text-left shadow-sm transition-colors hover:border-primary/40"
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
            className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
          >
            {action.label}
          </button>
        ))}
      </div>
    </article>
  );
}

function TaskColumn({ status, tasks, onAdd, onSelect }: TaskColumnProps) {
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
              <SortableTaskCard key={task.id} task={task} onSelect={() => onSelect(task)} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

type SortableTaskCardProps = {
  task: Task;
  onSelect: () => void;
};

function SortableTaskCard({ task, onSelect }: SortableTaskCardProps) {
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
      <TaskCardContent task={task} />
    </article>
  );
}

type TaskCardProps = {
  task: Task;
  isOverlay?: boolean;
};

function TaskCard({ task, isOverlay }: TaskCardProps) {
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

function TaskCardContent({ task }: { task: Task }) {
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
        {task.dueDate && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
    </>
  );
}

type TaskPanelProps = {
  open: boolean;
  onClose: () => void;
  draft: TaskDraft;
  setDraft: (draft: TaskDraft) => void;
  onSave: (e: React.FormEvent) => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
};

function TaskPanel({
  open,
  onClose,
  draft,
  setDraft,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: TaskPanelProps) {
  const isEdit = draft.mode === 'edit';

  return (
    <Transition show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-background/70 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex justify-end">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="translate-x-full opacity-0"
            enterTo="translate-x-0 opacity-100"
            leave="ease-in duration-150"
            leaveFrom="translate-x-0 opacity-100"
            leaveTo="translate-x-full opacity-0"
          >
            <DialogPanel className="flex h-full w-full max-w-md flex-col gap-4 border-l border-border bg-card p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <DialogTitle className="text-lg font-semibold text-foreground">
                    {isEdit ? 'Edit task' : 'Create task'}
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    Set details, status, and timing.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form className="flex flex-1 flex-col gap-4" onSubmit={onSave}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Title</label>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Short task summary"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Description
                  </label>
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={4}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="What needs to get done?"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Status</label>
                    <select
                      value={draft.status}
                      onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {TASK_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Priority</label>
                    <select
                      value={draft.priority}
                      onChange={(e) =>
                        setDraft({ ...draft, priority: e.target.value as Priority })
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {priorityOptions.map((priority) => (
                        <option key={priority} value={priority}>
                          {PRIORITY_LABELS[priority]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Due date</label>
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="date"
                      value={draft.dueDate}
                      onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-10 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3">
                  {isEdit ? (
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  ) : (
                    <div />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSaving ? 'Saving...' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </form>
            </DialogPanel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}

function createEmptyDraft(defaultStatus: TaskStatus = 'BACKLOG'): TaskDraft {
  return {
    mode: 'create',
    title: '',
    description: '',
    status: defaultStatus,
    priority: 'MEDIUM',
    dueDate: '',
  };
}

function toDateInput(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

function reorderTasks(
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
