'use client';

import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react';
import type { Project, ProjectStatus } from '@prisma/client';
import Link from 'next/link';
import { useMemo, Fragment } from 'react';
import { formatDate, STATUS_LABELS } from '@/lib/project-utils';
import { projectStatusEnum } from '@/lib/validations/project';
import { api } from '@/trpc/client';
import { PriorityBadge } from './priority-badge';
import { ExternalLink, Calendar, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getProjectTheme } from '@/lib/project-theme';

const STATUS_TONES: Record<ProjectStatus, string> = {
  IDEA: 'bg-zinc-400/60',
  IN_PROGRESS: 'bg-blue-400/60',
  MVP: 'bg-purple-400/60',
  COMPLETE: 'bg-emerald-400/60',
  ARCHIVE: 'bg-slate-400/60',
  DEFER: 'bg-amber-400/60',
  NOT_INTERESTED: 'bg-rose-400/60',
};

type Props = {
  project: Project;
};

export function ProjectCard({ project }: Props) {
  const utils = api.useContext();

  const statusMutation = api.project.updateStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.project.list.invalidate(),
        utils.project.getById.invalidate({ id: project.id }),
      ]);
    },
  });

  const statusOptions = useMemo(() => projectStatusEnum.options, []);
  const themeStyle = getProjectTheme(project.color);
  const hasColor = !!project.color;
  const tags = project.tags ?? [];
  const tagSummary = tags.length
    ? `#${tags[0]}${tags.length > 1 ? ` +${tags.length - 1}` : ''}`
    : '';
  const hasMeta = !!(project.dueDate || project.priority || tags.length > 0);

  return (
    <div
      style={themeStyle}
      className={cn(
        "group relative flex h-full flex-col rounded-xl border p-4 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md opacity-0 animate-slide-up",
        hasColor
          ? "border-[rgb(var(--project-accent)/0.25)] bg-[rgb(var(--project-accent)/0.04)] hover:border-[rgb(var(--project-accent)/0.5)]"
          : "border-border bg-card hover:border-primary/20"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors",
              hasColor
                ? "bg-[rgb(var(--project-accent)/0.1)] text-[rgb(var(--project-accent))]"
                : "bg-muted"
            )}
          >
            {project.icon || "🚀"}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{project.name}</h3>
            {project.description ? (
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {project.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {(project.dueDate || project.priority || tags.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {project.dueDate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
              <Calendar className="h-3 w-3" />
              Due {formatDate(project.dueDate)}
            </span>
          )}
          <PriorityBadge
            priority={project.priority}
            className="px-2 py-0.5 text-[11px]"
          />
          {tagSummary && (
            <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
              {tagSummary}
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          'flex items-center gap-2 text-[11px] font-medium text-muted-foreground',
          hasMeta ? 'mt-2' : 'mt-3'
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', STATUS_TONES[project.status])} />
        <span>{STATUS_LABELS[project.status]}</span>
      </div>

      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <Listbox
          value={project.status}
          onChange={(status) =>
            statusMutation.mutate({ id: project.id, status })
          }
        >
          <div className="relative">
            <ListboxButton className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20">
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="sr-only">Update status</span>
            </ListboxButton>
            <Transition
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <ListboxOptions className="absolute right-0 top-full z-20 mt-1 max-h-60 w-48 overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none">
                {statusOptions.map((status) => (
                  <ListboxOption
                    key={status}
                    value={status}
                    className={({ active, selected }) =>
                      cn(
                        "relative cursor-pointer select-none px-4 py-2",
                        active ? "bg-muted text-foreground" : "text-muted-foreground",
                        selected && "bg-muted/60 font-medium text-foreground"
                      )
                    }
                  >
                    {STATUS_LABELS[status]}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </Transition>
          </div>
        </Listbox>

        <Link
          href={`/projects/${project.id}/overview`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label="Open project"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
