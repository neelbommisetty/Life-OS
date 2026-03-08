"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Search,
  Archive,
  CalendarClock,
  CircleDashed,
  Flag,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
} from "@/lib/tasks/actions";
import { toastApiError } from "@/lib/api/error-toast";
import type { TaskStatus, Priority } from "@life-os/db";
import { KanbanColumn } from "./kanban-column";
import { getTaskEditorSummary } from "./task-editor-utils";
import { type TaskWithProject } from "./task-card";
import { selectDisplayedTasks } from "./tasks-utils";
import { getTaskSaveSuccessMessage } from "./task-save-feedback";
import { couldnt } from "@/lib/brand";
import { cn } from "@/lib/utils";

type TaskDraft = {
  id?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
};

function createEmptyDraft(): TaskDraft {
  return {
    title: "",
    description: "",
    status: "TODO",
    priority: "MEDIUM",
    dueDate: "",
  };
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

const STATUS_OPTIONS: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

const PRIORITY_OPTIONS: Priority[] = ["LOW", "MEDIUM", "HIGH"];

const STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  TODO: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  IN_PROGRESS:
    "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  DONE:
    "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const PRIORITY_BADGE_CLASSES: Record<Priority, string> = {
  LOW: "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  MEDIUM:
    "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  HIGH: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function TasksClient({
  projectId,
  initialTasks = [],
}: {
  projectId?: string;
  initialTasks?: TaskWithProject[];
}) {
  const [tasks, setTasks] = useState<TaskWithProject[]>(initialTasks);
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(createEmptyDraft());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<TaskWithProject | null>(
    null,
  );
  const [isCreating, startCreateTransition] = useTransition();
  const [isUpdating, startUpdateTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const isEdit = !!draft.id;
  const { selectedStatus, selectedPriority, dueDateLabel, summaryText } =
    getTaskEditorSummary({
      status: draft.status,
      priority: draft.priority,
      dueDate: draft.dueDate,
    });
  const isSaving = isCreating || isUpdating;

  const displayedTasks = selectDisplayedTasks({
    fetchedTasks: tasks,
  });

  // Load tasks only when searching or if projectId changes
  useEffect(() => {
    if (!search && initialTasks.length > 0 && !projectId) return;

    let cancelled = false;

    async function fetchTasks() {
      try {
        const result = await listTasks({
          search: search || undefined,
          projectId,
        });
        if (!cancelled) {
          setTasks(result);
        }
      } catch (error) {
        if (!cancelled) {
          toastApiError(error, couldnt("load tasks"));
        }
      }
    }

    void fetchTasks();

    return () => {
      cancelled = true;
    };
  }, [search, projectId, initialTasks.length]);

  // Exposed loadTasks for manual refresh
  const loadTasks = useCallback(async () => {
    try {
      const result = await listTasks({
        search: search || undefined,
        projectId,
      });
      setTasks(result);
    } catch (error) {
      toastApiError(error, couldnt("load tasks"));
    }
  }, [search, projectId]);

  // Handlers
  const handleCreate = () => {
    setDraft(createEmptyDraft());
    setSheetOpen(true);
  };

  const handleEdit = (task: TaskWithProject) => {
    setDraft({
      id: task.id,
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority,
      dueDate: formatDate(task.dueDate),
    });
    setSheetOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;

    if (isEdit && draft.id) {
      startUpdateTransition(async () => {
        try {
          await updateTask({
            id: draft.id!,
            title: draft.title.trim(),
            description: draft.description.trim() || undefined,
            status: draft.status,
            priority: draft.priority,
            dueDate: draft.dueDate || null,
          });
          setSheetOpen(false);
          await loadTasks();
          toast.success(getTaskSaveSuccessMessage(true));
        } catch (error) {
          toastApiError(error, couldnt("update the task"));
        }
      });
    } else {
      startCreateTransition(async () => {
        try {
          await createTask({
            title: draft.title.trim(),
            description: draft.description.trim() || undefined,
            status: draft.status,
            priority: draft.priority,
            dueDate: draft.dueDate || null,
            projectId,
          });
          setSheetOpen(false);
          await loadTasks();
          toast.success(getTaskSaveSuccessMessage(false));
        } catch (error) {
          toastApiError(error, couldnt("create the task"));
        }
      });
    }
  };

  const handleDeleteClick = (task: TaskWithProject) => {
    setTaskToDelete(task);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!taskToDelete) return;
    startDeleteTransition(async () => {
      try {
        await deleteTask({ id: taskToDelete.id });
        setDeleteDialogOpen(false);
        setTaskToDelete(null);
        await loadTasks();
      } catch (error) {
        toastApiError(error, couldnt("delete the task"));
      }
    });
  };

  const handleDropTask = async (taskId: string, newStatus: TaskStatus) => {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );

    try {
      await updateTask({ id: taskId, status: newStatus });
      // Reload to ensure consistency (e.g. updatedAt changes)
      // await loadTasks();
      // Actually, reloading might be jarring. We can stick with optimistic update if success.
    } catch (error) {
      toastApiError(error, couldnt("move the task"));
      // Revert on failure
      void loadTasks();
    }
  };

  const handleSheetOpenChange = (open: boolean) => {
    if (!open && isSaving) return;
    setSheetOpen(open);
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-full flex flex-col p-6 space-y-6">
        {/* Header */}
        <div className="flex shrink-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
            <p className="text-muted-foreground mt-1">
              Keep tasks moving, with clear next steps.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:flex-nowrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks..."
                className="pl-9 w-[200px]"
              />
            </div>
            <Button className="w-full sm:w-auto" variant="outline" asChild>
              <Link href="/tasks/archive">
                <Archive className="h-4 w-4 mr-2" />
                Archive
              </Link>
            </Button>
            <Button className="w-full sm:w-auto" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create task
            </Button>
          </div>
        </div>

        {/* Kanban Board */}
        <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-x-auto pb-4 min-h-0">
          <KanbanColumn
            title="To Do"
            status="TODO"
            tasks={displayedTasks.filter((t) => t.status === "TODO")}
            onDropTask={handleDropTask}
            onEditTask={handleEdit}
            onDeleteTask={handleDeleteClick}
            onMoveTask={handleDropTask}
          />
          <KanbanColumn
            title="In Progress"
            status="IN_PROGRESS"
            tasks={displayedTasks.filter((t) => t.status === "IN_PROGRESS")}
            onDropTask={handleDropTask}
            onEditTask={handleEdit}
            onDeleteTask={handleDeleteClick}
            onMoveTask={handleDropTask}
          />
          <KanbanColumn
            title="Done"
            status="DONE"
            tasks={displayedTasks.filter((t) => t.status === "DONE")}
            onDropTask={handleDropTask}
            onEditTask={handleEdit}
            onDeleteTask={handleDeleteClick}
            onMoveTask={handleDropTask}
          />
        </div>

        {/* Create/Edit Sheet */}
        <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
          <SheetContent
            showCloseButton={!isSaving}
            onEscapeKeyDown={(event) => {
              if (isSaving) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (isSaving) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (isSaving) event.preventDefault();
            }}
            className="w-full overflow-hidden border-l border-white/10 bg-[radial-gradient(circle_at_top,_rgba(83,109,254,0.16),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.98))] p-0 backdrop-blur-xl sm:max-w-xl dark:bg-[radial-gradient(circle_at_top,_rgba(83,109,254,0.2),_transparent_34%),linear-gradient(180deg,_rgba(10,15,24,0.98),_rgba(7,10,18,0.98))]"
          >
            <form
              onSubmit={handleSave}
              aria-busy={isSaving}
              className={cn(
                "flex h-full flex-col transition-opacity",
                isSaving && "pointer-events-none opacity-95",
              )}
            >
              <fieldset disabled={isSaving} className="contents">
                <SheetHeader className="gap-4 border-b border-border/60 bg-background/55 pb-5 pr-14">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <Badge
                        variant="outline"
                        className="border-primary/20 bg-primary/10 text-primary"
                      >
                        {isEdit ? "Update task" : "New task"}
                      </Badge>
                      <SheetTitle className="text-xl font-semibold tracking-tight">
                        {isEdit ? "Refine the next step" : "Capture the next step"}
                      </SheetTitle>
                    </div>
                    <div className="hidden rounded-3xl border border-border/70 bg-background/70 px-3 py-2 text-right text-xs text-muted-foreground shadow-sm sm:block">
                      <div className="font-medium text-foreground">
                        {draft.title.trim() || "Untitled task"}
                      </div>
                      <div>
                        {projectId
                          ? "Saved in this project"
                          : "Saved to your task board"}
                      </div>
                    </div>
                  </div>
                  <SheetDescription>
                    {isEdit
                      ? "Adjust the details, timing, or urgency."
                      : "Add just enough detail to keep work moving."}
                  </SheetDescription>
                </SheetHeader>

                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                <section className="rounded-[28px] border border-border/70 bg-background/70 p-4 shadow-sm backdrop-blur-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-7 rounded-full border px-3 text-xs font-medium",
                        STATUS_BADGE_CLASSES[draft.status],
                      )}
                    >
                      <CircleDashed className="size-3.5" />
                      {selectedStatus.label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-7 rounded-full border px-3 text-xs font-medium",
                        PRIORITY_BADGE_CLASSES[draft.priority],
                      )}
                    >
                      <Flag className="size-3.5" />
                      {selectedPriority.label} priority
                    </Badge>
                    <Badge
                      variant="outline"
                      className="h-7 rounded-full px-3 text-xs font-medium"
                    >
                      <CalendarClock className="size-3.5" />
                      {dueDateLabel}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {summaryText}
                  </p>
                </section>

                <section className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="task-title">Title</Label>
                    <p className="text-xs text-muted-foreground">
                      Use a specific action so the task is easy to start.
                    </p>
                  </div>
                  <Input
                    id="task-title"
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                    placeholder="Draft kickoff agenda"
                    className="h-12 rounded-[24px] border-border/70 bg-background/80 text-base shadow-sm"
                    required
                  />
                </section>

                <section className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="task-description">Notes</Label>
                    <p className="text-xs text-muted-foreground">
                      Add context, links, or the definition of done.
                    </p>
                  </div>
                  <Textarea
                    id="task-description"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                    placeholder="Include the outcome, constraints, or key details."
                    rows={5}
                    className="min-h-32 rounded-[24px] border-border/70 bg-background/80 shadow-sm"
                  />
                </section>

                <section className="space-y-4 rounded-[28px] border border-border/70 bg-background/70 p-4 shadow-sm">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium text-foreground">
                      Workflow
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Set the current state and urgency in one pass.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {STATUS_OPTIONS.map((option) => {
                      const summary = getTaskEditorSummary({
                        status: option,
                        priority: draft.priority,
                        dueDate: draft.dueDate,
                      });

                      return (
                        <Toggle
                          key={option}
                          variant="outline"
                          pressed={draft.status === option}
                          onClick={() =>
                            setDraft({ ...draft, status: option })
                          }
                          className={cn(
                            "h-auto flex-col items-start justify-start rounded-[22px] border px-4 py-3 text-left transition-all",
                            draft.status === option
                              ? "border-primary/40 bg-primary/10 shadow-sm"
                              : "border-border/70 bg-background/80 hover:border-foreground/20 hover:bg-muted/40",
                          )}
                        >
                          <div className="text-sm font-medium text-foreground">
                            {summary.selectedStatus.label}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {summary.selectedStatus.hint}
                          </div>
                        </Toggle>
                      );
                    })}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {PRIORITY_OPTIONS.map((option) => {
                      const summary = getTaskEditorSummary({
                        status: draft.status,
                        priority: option,
                        dueDate: draft.dueDate,
                      });

                      return (
                        <Toggle
                          key={option}
                          variant="outline"
                          pressed={draft.priority === option}
                          onClick={() =>
                            setDraft({ ...draft, priority: option })
                          }
                          className={cn(
                            "h-auto flex-col items-start justify-start rounded-[22px] border px-4 py-3 text-left transition-all",
                            draft.priority === option
                              ? "border-primary/40 bg-primary/10 shadow-sm"
                              : "border-border/70 bg-background/80 hover:border-foreground/20 hover:bg-muted/40",
                          )}
                        >
                          <div className="text-sm font-medium text-foreground">
                            {summary.selectedPriority.label}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {summary.selectedPriority.hint}
                          </div>
                        </Toggle>
                      );
                    })}
                  </div>

                  <Separator className="bg-border/70" />

                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="task-deadline">Deadline</Label>
                      <Input
                        id="task-deadline"
                        type="date"
                        value={draft.dueDate}
                        onChange={(e) =>
                          setDraft({ ...draft, dueDate: e.target.value })
                        }
                        className="h-11 rounded-[22px] border-border/70 bg-background/80 shadow-sm"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-self-start rounded-full px-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setDraft({ ...draft, dueDate: "" })}
                      disabled={!draft.dueDate}
                    >
                      Clear deadline
                    </Button>
                  </div>
                </section>

                <section className="grid gap-4 rounded-[28px] border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground sm:grid-cols-2">
                  <div>
                    <div className="font-medium text-foreground">Quick rule</div>
                    <p className="mt-1">
                      Keep titles action-first. Put supporting detail in notes.
                    </p>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Save target</div>
                    <p className="mt-1">
                      {projectId
                        ? "This task stays attached to the current project."
                        : "This task will appear on your main board."}
                    </p>
                  </div>
                </section>
                </div>
                <SheetFooter className="border-t border-border/60 bg-background/80 sm:flex-row sm:items-center sm:justify-between">
                  <p className="hidden text-xs text-muted-foreground sm:block">
                    {draft.title.trim()
                      ? "Ready to save."
                      : "Add a title to save this task."}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSheetOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSaving || !draft.title.trim()}
                      className="min-w-32"
                    >
                      {isSaving
                        ? "Saving..."
                        : isEdit
                          ? "Save changes"
                          : "Create task"}
                    </Button>
                  </div>
                </SheetFooter>
              </fieldset>
            </form>
          </SheetContent>
        </Sheet>

        {/* Delete Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Task</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{taskToDelete?.title}&quot;? This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DndProvider>
  );
}
