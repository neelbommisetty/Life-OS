import type { Project } from "@prisma/client";
import { formatDate } from "@/lib/project-utils";
import { PriorityBadge } from "./priority-badge";
import { StatusBadge } from "./status-badge";

type Props = {
  project: Project;
  actions?: React.ReactNode;
};

export function ProjectHeader({ project, actions }: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {project.icon ? <span className="text-2xl">{project.icon}</span> : null}
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{project.name}</h1>
            <p className="text-sm text-zinc-600">
              Last updated {formatDate(project.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={project.status} />
          <PriorityBadge priority={project.priority} />
          {actions}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700">
        {project.tags?.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700"
          >
            #{tag}
          </span>
        ))}
        {project.dueDate ? (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
            Due {formatDate(project.dueDate)}
          </span>
        ) : null}
        {project.color ? (
          <span className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
            <span
              className="h-3 w-3 rounded-full border border-zinc-200"
              style={{ backgroundColor: project.color }}
            />
            {project.color}
          </span>
        ) : null}
      </div>
    </div>
  );
}

