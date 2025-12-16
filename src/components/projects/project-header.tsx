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
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {project.icon ? <span className="text-2xl">{project.icon}</span> : null}
          <div>
            <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            <p className="text-sm text-muted-foreground">
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

      <div className="flex flex-wrap items-center gap-3 text-sm text-foreground">
        {project.tags?.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-foreground"
          >
            #{tag}
          </span>
        ))}
        {project.dueDate ? (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
            Due {formatDate(project.dueDate)}
          </span>
        ) : null}
        {project.color ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium text-foreground">
            <span
              className="h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: project.color }}
            />
            {project.color}
          </span>
        ) : null}
      </div>
    </div>
  );
}

