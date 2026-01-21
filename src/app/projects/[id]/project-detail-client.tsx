"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PlusIcon, MessageSquareIcon, CheckSquareIcon, FileTextIcon, ArrowLeftIcon, SettingsIcon } from "lucide-react";
import {
  updateProject,
  type UpdateProjectInput,
} from "@/lib/projects";
import { createThread } from "@/lib/chat";
import { createTask } from "@/lib/tasks";
import { createNote } from "@/lib/notes";
import type { Project, ChatThread, Task, Note } from "@prisma/client";

interface ProjectDetailClientProps {
  project: Project & {
    chatThreads: ChatThread[];
    tasks: Task[];
    notes: Note[];
  };
}

export function ProjectDetailClient({ project: initialProject }: ProjectDetailClientProps) {
  const router = useRouter();
  const [project] = useState(initialProject);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<Omit<UpdateProjectInput, "id">>({
    name: project.name,
    description: project.description || "",
    aiInstructions: project.aiInstructions || "",
  });

  const handleEdit = async () => {
    setIsEditing(true);
    try {
      await updateProject({
        id: project.id,
        ...editFormData,
      });
      setIsEditOpen(false);
      router.refresh();
    } catch (error) {
      console.error("Failed to update project:", error);
      alert(error instanceof Error ? error.message : "Failed to update project");
    } finally {
      setIsEditing(false);
    }
  };

  const handleCreateThread = async () => {
    try {
      const thread = await createThread({ projectId: project.id });
      router.push(`/chat?threadId=${thread.id}`);
    } catch (error) {
      console.error("Failed to create thread:", error);
      alert(error instanceof Error ? error.message : "Failed to create thread");
    }
  };

  const handleCreateTask = async () => {
    try {
      await createTask({
        title: "New task",
        status: "TODO",
        priority: "MEDIUM",
        projectId: project.id,
      });
      router.push(`/tasks`);
      router.refresh();
    } catch (error) {
      console.error("Failed to create task:", error);
      alert(error instanceof Error ? error.message : "Failed to create task");
    }
  };

  const handleCreateNote = async () => {
    try {
      const note = await createNote({
        title: "New note",
        content: "",
        projectId: project.id,
      });
      router.push(`/notes/${note.id}`);
    } catch (error) {
      console.error("Failed to create note:", error);
      alert(error instanceof Error ? error.message : "Failed to create note");
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back to Projects
          </Button>
        </Link>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-bold">{project.name}</h1>
            {project.description && (
              <p className="text-muted-foreground mt-2">{project.description}</p>
            )}
          </div>
          <AlertDialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <SettingsIcon className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Edit Project</AlertDialogTitle>
                <AlertDialogDescription>
                  Update project details and AI instructions.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editFormData.name}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, name: e.target.value })
                    }
                    disabled={isEditing}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-description">Description</Label>
                  <Textarea
                    id="edit-description"
                    value={editFormData.description}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, description: e.target.value })
                    }
                    disabled={isEditing}
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-aiInstructions">AI Instructions</Label>
                  <Textarea
                    id="edit-aiInstructions"
                    value={editFormData.aiInstructions}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, aiInstructions: e.target.value })
                    }
                    disabled={isEditing}
                    rows={3}
                  />
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isEditing}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleEdit}
                  disabled={isEditing || !editFormData.name?.trim()}
                >
                  {isEditing ? "Saving..." : "Save Changes"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Chat Threads Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <MessageSquareIcon className="h-5 w-5" />
                Chat Threads
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={handleCreateThread}>
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {project.chatThreads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No threads yet</p>
            ) : (
              <div className="space-y-2">
                {project.chatThreads.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/chat?threadId=${thread.id}`}
                    className="block p-2 rounded hover:bg-accent text-sm truncate"
                  >
                    {thread.name}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tasks Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <CheckSquareIcon className="h-5 w-5" />
                Tasks
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={handleCreateTask}>
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {project.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet</p>
            ) : (
              <div className="space-y-2">
                {project.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-2 rounded hover:bg-accent text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          task.status === "DONE"
                            ? "bg-green-500/20 text-green-700 dark:text-green-300"
                            : task.status === "IN_PROGRESS"
                            ? "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                            : "bg-gray-500/20 text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {task.status}
                      </span>
                      <span className="truncate">{task.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileTextIcon className="h-5 w-5" />
                Notes
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={handleCreateNote}>
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {project.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet</p>
            ) : (
              <div className="space-y-2">
                {project.notes.map((note) => (
                  <Link
                    key={note.id}
                    href={`/notes/${note.id}`}
                    className="block p-2 rounded hover:bg-accent text-sm truncate"
                  >
                    {note.title}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
