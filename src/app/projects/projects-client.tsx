'use client';

import { useState } from "react";
import type { ProjectStatus } from "@prisma/client";
import { api } from "@/trpc/client";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { StatusFilter } from "@/components/projects/status-filter";

export function ProjectsClient() {
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const { data, isLoading } = api.project.list.useQuery(
    status ? { status } : undefined,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Track project lifecycle, quick status changes, and last updates.
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      <StatusFilter value={status} onChange={setStatus} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-border bg-muted"
            />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No projects yet. Create your first project to get started.
          </p>
        </div>
      )}
    </div>
  );
}

