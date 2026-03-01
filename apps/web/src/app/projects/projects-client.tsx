"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { PlusIcon } from "lucide-react";
import { createProject, type CreateProjectInput } from "@/lib/projects";
import { ProjectCard } from "@/components/projects/project-card";
import { toastApiError } from "@/lib/api/error-toast";
import type { Project } from "@life-os/db";
import { couldnt } from "@/lib/brand";

interface ProjectsClientProps {
  initialProjects: Project[];
}

export function ProjectsClient({ initialProjects }: ProjectsClientProps) {
  const router = useRouter();
  const [projects] = useState(initialProjects);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<CreateProjectInput>({
    name: "",
    description: "",
    aiInstructions: "",
  });

  const handleCreate = async () => {
    if (!formData.name.trim()) return;

    setIsCreating(true);
    try {
      const project = await createProject(formData);
      setIsCreateOpen(false);
      setFormData({ name: "", description: "", aiInstructions: "" });
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (error) {
      toastApiError(error, couldnt("create the project"));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col p-6">
      <div className="flex shrink-0 items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Group threads, tasks, and notes.
          </p>
        </div>
        <AlertDialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <AlertDialogTrigger asChild>
            <Button>
              <PlusIcon className="h-4 w-4 mr-2" />
              Create project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Create project</AlertDialogTitle>
              <AlertDialogDescription>
                Create a project to group related threads, tasks, and notes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Project name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  disabled={isCreating}
                />
              </div>
              <div>
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  placeholder="What is this project about?"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  disabled={isCreating}
                  rows={3}
                />
              </div>
              <div>
                <Label htmlFor="aiInstructions">Assistant instructions (optional)</Label>
                <Textarea
                  id="aiInstructions"
                  placeholder="How the assistant should behave in this project"
                  value={formData.aiInstructions}
                  onChange={(e) =>
                    setFormData({ ...formData, aiInstructions: e.target.value })
                  }
                  disabled={isCreating}
                  rows={3}
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isCreating}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCreate}
                disabled={isCreating || !formData.name.trim()}
              >
                {isCreating ? "Creating..." : "Create project"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No projects yet.</p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-2" />
              Create project
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
