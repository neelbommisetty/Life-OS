'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, MessageSquare, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getProjectTheme } from '@/lib/project-theme';
import { STATUS_LABELS, formatDate } from '@/lib/project-utils';
import type { ProjectStatus } from '@prisma/client';

type Props = {
  project: {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    status: ProjectStatus;
    updatedAt: Date | string;
  };
};

export function ContinueCard({ project }: Props) {
  const router = useRouter();
  const themeStyle = getProjectTheme(project.color);
  const hasColor = !!project.color;

  const handleCardClick = () => {
    router.push(`/projects/${project.id}/overview`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-10"
    >
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Continue where you left off
      </h2>
      <div
        onClick={handleCardClick}
        className={cn(
          "group relative overflow-hidden rounded-2xl border p-6 shadow-sm transition-all hover:shadow-md cursor-pointer",
          hasColor
            ? "border-[rgb(var(--project-accent)/0.3)] bg-[rgb(var(--project-accent)/0.05)] hover:border-[rgb(var(--project-accent)/0.6)]"
            : "border-border bg-card hover:border-primary/20"
        )}
        style={themeStyle}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl transition-transform group-hover:scale-110",
                hasColor
                  ? "bg-[rgb(var(--project-accent)/0.15)] text-[rgb(var(--project-accent))]"
                  : "bg-muted"
              )}
            >
              {project.icon || "🚀"}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-foreground">{project.name}</h3>
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {STATUS_LABELS[project.status]}
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {project.description || "No description provided."}
              </p>
              <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Last edited {formatDate(project.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${project.id}/chat`}
              className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm ring-1 ring-inset ring-border transition hover:bg-muted"
              onClick={(e) => e.stopPropagation()}
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Brainstorm
            </Link>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCardClick();
              }}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition",
                hasColor
                  ? "bg-[rgb(var(--project-accent))] text-white hover:opacity-90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              Open Project
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>
        </div>

        {hasColor && (
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-10 blur-3xl"
            style={{ backgroundColor: `rgb(var(--project-accent))` }}
          />
        )}
      </div>
    </motion.div>
  );
}
