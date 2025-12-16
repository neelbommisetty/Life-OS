import type { Project } from "@prisma/client";
import { formatDate } from "@/lib/project-utils";
import { PriorityBadge } from "./priority-badge";
import { StatusBadge } from "./status-badge";
import { Calendar, Tag, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProjectTheme } from "@/lib/project-theme";

type Props = {
  project: Project;
  actions?: React.ReactNode;
};

export function ProjectHeader({ project, actions }: Props) {
  const themeStyle = getProjectTheme(project.color);
  const hasColor = !!project.color;

  return (
    <div
      style={themeStyle}
      className={cn(
        "flex flex-col gap-6 rounded-xl border border-border bg-card p-6 shadow-sm",
        hasColor && "border-l-4 border-l-[rgb(var(--project-accent))]"
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-3xl",
              hasColor
                ? "bg-[rgb(var(--project-accent)/0.1)] text-[rgb(var(--project-accent))]"
                : "bg-muted"
            )}
          >
            {project.icon || "🚀"}
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            <p className="text-sm text-muted-foreground">
              Last updated {formatDate(project.updatedAt)}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <StatusBadge status={project.status} />
              <PriorityBadge priority={project.priority} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {actions}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4 text-sm text-muted-foreground">
        {project.dueDate && (
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            <span>Due {formatDate(project.dueDate)}</span>
          </div>
        )}

        {project.tags && project.tags.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Tag className="h-4 w-4" />
            <div className="flex gap-1">
              {project.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {project.color && (
          <div className="flex items-center gap-1.5">
            <Palette className="h-4 w-4" />
            <div className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              <span
                className="h-2 w-2 rounded-full ring-1 ring-border"
                style={{ backgroundColor: project.color }}
              />
              {project.color}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
