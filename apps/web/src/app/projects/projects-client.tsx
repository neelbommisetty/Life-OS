"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { ProjectCard } from "@/components/projects/project-card";
import type { Project } from "@life-os/db";
import { getProjectCreateHref } from "./project-create-utils";

interface ProjectsClientProps {
  initialProjects: Project[];
}

export function ProjectsClient({ initialProjects }: ProjectsClientProps) {
  return (
    <div className="flex h-full w-full flex-col p-6">
      <div className="mb-8 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground">
            Group assistant work, tasks, and notes.
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href={getProjectCreateHref()}>
            <PlusIcon className="h-4 w-4 mr-2" />
            Create project
          </Link>
        </Button>
      </div>

      {initialProjects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No projects yet.</p>
            <Button asChild>
              <Link href={getProjectCreateHref()}>
                <PlusIcon className="h-4 w-4 mr-2" />
                Create project
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
