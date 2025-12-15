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
          <h1 className="text-2xl font-bold text-zinc-900">Projects</h1>
          <p className="text-sm text-zinc-600">
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
              className="h-40 rounded-xl border border-zinc-200 bg-zinc-50 animate-pulse"
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
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-10 text-center">
          <p className="text-sm text-zinc-600">
            No projects yet. Create your first project to get started.
          </p>
        </div>
      )}
    </div>
  );
}

