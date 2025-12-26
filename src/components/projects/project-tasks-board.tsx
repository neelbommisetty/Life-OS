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
  type DragStartEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Priority, Task, TaskStatus } from '@prisma/client';
import { Calendar, Filter, MessageSquareIcon, Plus, Search, Trash2, X } from 'lucide-react';
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
import { resolveTasksViewParam } from '@/lib/project-deeplinks';
import { pushUrl, useUrlState } from '@/lib/url-state';
import {
  ArchivedList,
  BacklogList,
  TaskCard,
  TaskColumn,
  TaskPanel,
  type TaskDraft,
  type TaskView,
} from './task-board';
import { createEmptyDraft, reorderTasks, toDateInput, findTaskThreadId, buildTaskThreadName, buildTaskMessageTemplate } from './project-tasks-board-utils';

const priorityOptions = priorityEnum.options as Priority[];
const statusOptions = taskStatusEnum.options as TaskStatus[];

export function ProjectTasksBoard({ projectId, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const utils = api.useUtils();
  const urlState = useUrlState();
  const searchParams = useMemo(() => new URLSearchParams(urlState.search), [urlState.search]);
  const { data, isLoading } = api.task.list.useQuery({ projectId });
  const threadsQuery = api.chat.listThreads.useQuery({ projectId });
  const tasks = useMemo(() => data ?? [], [data]);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'ALL'>('ALL');
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => createEmptyDraft());
  const activeView = useMemo(() => {
    const viewParam = resolveTasksViewParam(searchParams.get('tasksView'));
    return viewParam.toUpperCase() as TaskView;
  }, [searchParams]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [creatingThreadId, setCreatingThreadId] = useState<string | null>(null);

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

  const createThread = api.chat.createThread.useMutation({
    onSuccess: () => {
      utils.chat.listThreads.invalidate({ projectId });
    },
  });

  const setThreadIdInUrl = useCallback(
    (threadId: string, draftMessage?: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('threadId', threadId);
      if (draftMessage) {
        nextParams.set('chatDraft', draftMessage);
      }
      const query = nextParams.toString();
      const basePath = urlState.pathname || `/projects/${projectId}/tasks`;
      pushUrl(query ? `${basePath}?${query}` : basePath);
    },
    [projectId, searchParams, urlState.pathname]
  );

  const handleCreateTaskThread = useCallback(
    (task: Task) => {
      if (createThread.isPending) {
        return;
      }
      const existingThreadId = findTaskThreadId(
        threadsQuery.data ?? [],
        task.id
      );
      if (existingThreadId) {
        setThreadIdInUrl(existingThreadId, buildTaskMessageTemplate(task));
        return;
      }
      setCreatingThreadId(task.id);
      createThread.mutate(
        {
          projectId,
          name: buildTaskThreadName(task),
        },
        {
          onSuccess: (thread) => {
            setThreadIdInUrl(thread.id, buildTaskMessageTemplate(task));
          },
          onSettled: () => {
            setCreatingThreadId(null);
          },
        }
      );
    },
    [createThread, projectId, setThreadIdInUrl, threadsQuery.data]
  );

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

  const updateTasksView = useCallback(
    (nextView: TaskView) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (nextView === 'KANBAN') {
        nextParams.delete('tasksView');
      } else {
        nextParams.set('tasksView', nextView.toLowerCase());
      }
      const query = nextParams.toString();
      const basePath = `/projects/${projectId}/tasks`;
      pushUrl(query ? `${basePath}?${query}` : basePath);
    },
    [projectId, searchParams]
  );

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

  const handleDragStart = (event: DragStartEvent) => {
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
              onClick={() => updateTasksView('KANBAN')}
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
              onClick={() => updateTasksView('BACKLOG')}
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
              onClick={() => updateTasksView('ARCHIVED')}
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
                onBrainstorm={handleCreateTaskThread}
                creatingThreadId={creatingThreadId}
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
          onBrainstorm={handleCreateTaskThread}
          creatingThreadId={creatingThreadId}
        />
      ) : (
        <ArchivedList
          tasks={archivedTasks}
          onSelect={openEditPanel}
          onMove={(task, status) => handleQuickStatusChange(task, status)}
          onBrainstorm={handleCreateTaskThread}
          creatingThreadId={creatingThreadId}
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
        statusOptions={statusOptions}
        priorityOptions={priorityOptions}
        priorityLabels={PRIORITY_LABELS}
      />

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading tasks...</p>
      )}
    </section>
  );
}


export type Props = {
  projectId: string;
  accentColor?: string | null;
};
