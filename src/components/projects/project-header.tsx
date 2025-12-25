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
  const visibleTags = project.tags?.slice(0, 3) ?? [];
  const extraTags = project.tags.length - visibleTags.length;

  return (
    <div
      style={themeStyle}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3 shadow-sm",
        hasColor && "border-l-4 border-l-[rgb(var(--project-accent))]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl",
              hasColor
                ? "bg-[rgb(var(--project-accent)/0.1)] text-[rgb(var(--project-accent))]"
                : "bg-muted"
            )}
          >
            {project.icon || "🚀"}
          </div>
          <div className="min-w-0 space-y-0.5">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {project.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              Updated {formatDate(project.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={project.status} />
        <PriorityBadge priority={project.priority} />
        {project.dueDate && (
          <div className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1">
            <Calendar className="h-3.5 w-3.5" />
            <span>Due {formatDate(project.dueDate)}</span>
          </div>
        )}
        {visibleTags.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1">
            <Tag className="h-3.5 w-3.5" />
            <div className="flex gap-1">
              {visibleTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                >
                  {tag}
                </span>
              ))}
              {extraTags > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  +{extraTags}
                </span>
              )}
            </div>
          </div>
        )}
        {project.color && (
          <div className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1">
            <Palette className="h-3.5 w-3.5" />
            <div className="flex items-center gap-1 text-[11px] font-medium text-foreground">
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
