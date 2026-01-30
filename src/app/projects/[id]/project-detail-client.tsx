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
import {
  ArrowLeftIcon,
  SettingsIcon,
  Bot,
  Info,
  MessageSquareIcon,
  CheckSquareIcon,
  FileTextIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { updateProject, type UpdateProjectInput } from "@/lib/projects";
import type { Project, ChatThread, Task, Note } from "@prisma/client";
import { TasksClient } from "@/app/tasks/tasks-client";
import { NotesClient } from "@/app/notes/notes-client";
import { ChatClient } from "@/app/chat/chat-client";

interface ProjectDetailClientProps {
  project: Project & {
    chatThreads: ChatThread[];
    tasks: Task[];
    notes: Note[];
  };
}

export function ProjectDetailClient({
  project: initialProject,
}: ProjectDetailClientProps) {
  const router = useRouter();
  const [project] = useState(initialProject);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<
    Omit<UpdateProjectInput, "id">
  >({
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
      alert(
        error instanceof Error ? error.message : "Failed to update project",
      );
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="container mx-auto p-6 max-w-7xl flex-none">
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
                <p className="text-muted-foreground mt-2">
                  {project.description}
                </p>
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
                        setEditFormData({
                          ...editFormData,
                          name: e.target.value,
                        })
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
                        setEditFormData({
                          ...editFormData,
                          description: e.target.value,
                        })
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
                        setEditFormData({
                          ...editFormData,
                          aiInstructions: e.target.value,
                        })
                      }
                      disabled={isEditing}
                      rows={3}
                    />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isEditing}>
                    Cancel
                  </AlertDialogCancel>
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
      </div>

      <div className="flex-1 min-h-0 container mx-auto px-6 max-w-7xl">
        <Tabs defaultValue="overview">
          <TabsList variant="line">
            <TabsTrigger value="overview" className="gap-2">
              <Info className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-2">
              <MessageSquareIcon className="h-4 w-4" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="tasks" className="gap-2">
              <CheckSquareIcon className="h-4 w-4" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="notes" className="gap-2">
              <FileTextIcon className="h-4 w-4" />
              Notes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-auto">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    Project Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="font-medium mb-1">Description</h3>
                    <p className="text-sm text-muted-foreground">
                      {project.description || "No description provided."}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-medium mb-1">Created</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    AI Instructions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {project.aiInstructions ||
                      "No specific AI instructions configured for this project."}
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent
            value="chat"
            className="flex-1 min-h-0 border rounded-lg overflow-hidden"
          >
            <ChatClient projectId={project.id} />
          </TabsContent>

          <TabsContent value="tasks" className="flex-1 min-h-0 overflow-hidden">
            <TasksClient projectId={project.id} />
          </TabsContent>

          <TabsContent
            value="notes"
            className="flex-1 min-h-0 border rounded-lg overflow-hidden"
          >
            <NotesClient projectId={project.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
