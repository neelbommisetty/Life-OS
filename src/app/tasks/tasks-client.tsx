"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Search, Archive } from "lucide-react";
import Link from "next/link";
import {
  listTasks,
  createTask,
  updateTask,
  deleteTask,
} from "@/lib/tasks/actions";
import type { TaskStatus, Priority } from "@prisma/client";
import { KanbanColumn } from "./kanban-column";
import { type TaskWithProject } from "./task-card";

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

export function TasksClient({ projectId }: { projectId?: string }) {
  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
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

  // Load tasks - inline to avoid setState-in-effect lint error
  useEffect(() => {
    let cancelled = false;
    
    async function fetchTasks() {
      try {
        // The backend now handles auto-archiving of tasks older than 7 days
        const result = await listTasks({
          search: search || undefined,
          projectId,
        });
        if (!cancelled) {
          setTasks(result);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load tasks:", error);
        }
      }
    }

    void fetchTasks();

    return () => {
      cancelled = true;
    };
  }, [search, projectId]);

  // Exposed loadTasks for manual refresh
  const loadTasks = useCallback(async () => {
    try {
      const result = await listTasks({
        search: search || undefined,
        projectId,
      });
      setTasks(result);
    } catch (error) {
      console.error("Failed to load tasks:", error);
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
        } catch (error) {
          console.error("Failed to update task:", error);
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
        } catch (error) {
          console.error("Failed to create task:", error);
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
        console.error("Failed to delete task:", error);
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
      console.error("Failed to move task:", error);
      // Revert on failure
      loadTasks();
    }
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-full flex flex-col p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
            <p className="text-muted-foreground mt-1">
              Manage your tasks with the Kanban board
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="pl-9 w-[200px]"
              />
            </div>
            <Button variant="outline" asChild>
              <Link href="/tasks/archive">
                <Archive className="h-4 w-4 mr-2" />
                Archive
              </Link>
            </Button>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              New Task
            </Button>
          </div>
        </div>

        {/* Kanban Board */}
        <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-x-auto pb-4 min-h-0">
          <KanbanColumn
            title="To Do"
            status="TODO"
            tasks={tasks.filter((t) => t.status === "TODO")}
            onDropTask={handleDropTask}
            onEditTask={handleEdit}
            onDeleteTask={handleDeleteClick}
          />
          <KanbanColumn
            title="In Progress"
            status="IN_PROGRESS"
            tasks={tasks.filter((t) => t.status === "IN_PROGRESS")}
            onDropTask={handleDropTask}
            onEditTask={handleEdit}
            onDeleteTask={handleDeleteClick}
          />
          <KanbanColumn
            title="Done"
            status="DONE"
            tasks={tasks.filter((t) => t.status === "DONE")}
            onDropTask={handleDropTask}
            onEditTask={handleEdit}
            onDeleteTask={handleDeleteClick}
          />
        </div>

        {/* Create/Edit Sheet */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent className="w-full sm:max-w-md">
            <form onSubmit={handleSave} className="flex flex-col h-full">
              <SheetHeader>
                <SheetTitle>{isEdit ? "Edit Task" : "Create Task"}</SheetTitle>
                <SheetDescription>
                  {isEdit
                    ? "Update task details below"
                    : "Fill in the details to create a new task"}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-4 py-6 overflow-y-auto">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Title *</label>
                  <Input
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                    placeholder="Task title"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                    placeholder="Task description"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Status</label>
                    <Select
                      value={draft.status}
                      onValueChange={(value) =>
                        setDraft({ ...draft, status: value as TaskStatus })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TODO">To Do</SelectItem>
                        <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                        <SelectItem value="DONE">Done</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Priority</label>
                    <Select
                      value={draft.priority}
                      onValueChange={(value) =>
                        setDraft({ ...draft, priority: value as Priority })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Due Date</label>
                  <Input
                    type="date"
                    value={draft.dueDate}
                    onChange={(e) =>
                      setDraft({ ...draft, dueDate: e.target.value })
                    }
                  />
                </div>
              </div>

              <SheetFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSheetOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isCreating || isUpdating || !draft.title.trim()}
                >
                  {isCreating || isUpdating
                    ? "Saving..."
                    : isEdit
                      ? "Save Changes"
                      : "Create Task"}
                </Button>
              </SheetFooter>
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
