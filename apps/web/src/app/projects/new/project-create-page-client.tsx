"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { createProject, type CreateProjectInput } from "@/lib/projects";
import { toastApiError } from "@/lib/api/error-toast";
import { couldnt } from "@/lib/brand";
import {
  buildCreateProjectPayload,
  getProjectDetailHref,
} from "../project-create-utils";

export function ProjectCreatePageClient() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<CreateProjectInput>({
    name: "",
    description: "",
    aiInstructions: "",
  });

  const handleCreate = async () => {
    const payload = buildCreateProjectPayload(formData);

    if (!payload || isCreating) return;

    setIsCreating(true);
    try {
      const project = await createProject(payload);
      router.push(getProjectDetailHref(project.id));
    } catch (error) {
      toastApiError(error, couldnt("create the project"));
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col p-6">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/projects">Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>New project</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Create project</h1>
        <p className="max-w-2xl text-muted-foreground">
          Set up the space for related assistant work, tasks, and notes.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="space-y-6 p-6 sm:p-8">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Project name"
              value={formData.name}
              onChange={(event) =>
                setFormData({ ...formData, name: event.target.value })
              }
              disabled={isCreating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What is this project about?"
              value={formData.description}
              onChange={(event) =>
                setFormData({ ...formData, description: event.target.value })
              }
              disabled={isCreating}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="aiInstructions">Assistant instructions (optional)</Label>
            <Textarea
              id="aiInstructions"
              placeholder="How the assistant should behave in this project"
              value={formData.aiInstructions}
              onChange={(event) =>
                setFormData({ ...formData, aiInstructions: event.target.value })
              }
              disabled={isCreating}
              rows={5}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-sm text-muted-foreground">
            You can update the project details later.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              type="button"
              onClick={() => router.push("/projects")}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={isCreating || !formData.name.trim()}
            >
              {isCreating ? "Creating..." : "Create project"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
