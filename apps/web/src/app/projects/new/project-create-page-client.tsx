"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { CreateProjectInput } from "@/lib/projects";
import {
  toastApiError,
  toastApiResponseError,
} from "@/lib/api/error-toast";
import { couldnt } from "@/lib/brand";
import {
  buildCreateProjectPayload,
  getProjectDetailHref,
} from "../project-create-utils";
import { getProjectCreateFeedback } from "./project-create-page-utils";

type CreateProjectResponse = {
  id: string;
};

export function ProjectCreatePageClient() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateProjectInput>({
    name: "",
    description: "",
    aiInstructions: "",
  });
  const feedback = getProjectCreateFeedback(isCreating, errorMessage);

  const handleCreate = async () => {
    const payload = buildCreateProjectPayload(formData);

    if (!payload || isCreating) return;

    setErrorMessage(null);
    setIsCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await toastApiResponseError(
          response,
          couldnt("create the project"),
        );
        setErrorMessage(message);
        setIsCreating(false);
        return;
      }

      const project = (await response.json()) as CreateProjectResponse;
      router.push(getProjectDetailHref(project.id));
    } catch (error) {
      const message = toastApiError(error, couldnt("create the project"));
      setErrorMessage(message);
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
              onChange={(event) => {
                setErrorMessage(null);
                setFormData({ ...formData, name: event.target.value });
              }}
              disabled={isCreating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What is this project about?"
              value={formData.description}
              onChange={(event) => {
                setErrorMessage(null);
                setFormData({ ...formData, description: event.target.value });
              }}
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
              onChange={(event) => {
                setErrorMessage(null);
                setFormData({ ...formData, aiInstructions: event.target.value });
              }}
              disabled={isCreating}
              rows={5}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p
            aria-live="polite"
            className={cn(
              "text-sm",
              feedback.tone === "error"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {feedback.message}
          </p>
          <p className="text-sm text-muted-foreground sm:ml-auto">
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
