'use client';

import Link from 'next/link';
import { formatDate } from '@/lib/project-utils';
import { STATUS_LABELS } from '@/lib/project-utils';
import type { Project } from '@prisma/client';
import { cn } from '@/lib/utils';
import { Clock, Tag, ExternalLink } from 'lucide-react';

type Props = {
  projects: Project[];
};

export function ProjectListView({ projects }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priority</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Due Date</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Last Updated</th>
              <th className="px-6 py-4 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {projects.map((project) => (
              <tr
                key={project.id}
                className="group hover:bg-muted/30 transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/projects/${project.id}/overview`}
                    className="flex items-center gap-3 font-bold text-foreground hover:text-primary transition-colors"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-lg group-hover:scale-110 transition-transform">
                      {project.icon || "🚀"}
                    </span>
                    <span className="truncate max-w-[200px]">{project.name}</span>
                  </Link>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {STATUS_LABELS[project.status]}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "text-xs font-bold uppercase",
                    project.priority === 'URGENT' ? "text-red-500" :
                    project.priority === 'HIGH' ? "text-orange-500" :
                    project.priority === 'MEDIUM' ? "text-blue-500" :
                    "text-muted-foreground"
                  )}>
                    {project.priority || "MEDIUM"}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-muted-foreground hidden sm:table-cell">
                  {project.dueDate ? (
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDate(project.dueDate)}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-6 py-4 text-sm text-muted-foreground hidden lg:table-cell">
                  {formatDate(project.updatedAt)}
                </td>
                <td className="px-6 py-4 text-right">
                  <Link
                    href={`/projects/${project.id}/overview`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
