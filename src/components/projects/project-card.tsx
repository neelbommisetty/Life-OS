'use client';

import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react';
import type { Project } from '@prisma/client';
import Link from 'next/link';
import { useMemo, Fragment } from 'react';
import { formatDate, STATUS_LABELS } from '@/lib/project-utils';
import { projectStatusEnum } from '@/lib/validations/project';
import { api } from '@/trpc/client';
import { PriorityBadge } from './priority-badge';
import { StatusBadge } from './status-badge';
import { ChevronDown, ExternalLink, Calendar, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { getProjectTheme } from '@/lib/project-theme';

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      style={themeStyle}
      className={cn(
        "group flex h-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md",
        hasColor
          ? "hover:border-[rgb(var(--project-accent)/0.5)]"
          : "hover:border-primary/20"
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg text-xl transition-colors",
                hasColor
                  ? "bg-[rgb(var(--project-accent)/0.1)] text-[rgb(var(--project-accent))]"
                  : "bg-muted"
              )}
            >
              {project.icon || "🚀"}
            </div>
            <div>
              <h3 className="line-clamp-1 font-semibold text-foreground">{project.name}</h3>
              <p className="text-xs text-muted-foreground">
                Updated {formatDate(project.updatedAt)}
              </p>
            </div>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <div className="mt-4">
          <p className={cn(
            "line-clamp-2 text-sm text-muted-foreground",
            !project.description && "italic"
          )}>
            {project.description || "No description provided."}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <PriorityBadge priority={project.priority} />
          {project.tags?.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              #{tag}
            </span>
          ))}
          {(project.tags?.length || 0) > 3 && (
            <span className="text-xs text-muted-foreground">+{project.tags!.length - 3}</span>
          )}
        </div>

        {project.dueDate && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>Due {formatDate(project.dueDate)}</span>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <div className="flex-1">
          <Listbox
            value={project.status}
            onChange={(status) =>
              statusMutation.mutate({ id: project.id, status })
            }
          >
            <div className="relative">
              <ListboxButton className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20">
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  Update Status
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </ListboxButton>
              <Transition
                as={Fragment}
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <ListboxOptions className="absolute bottom-full mb-1 z-20 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                  {statusOptions.map((status) => (
                    <ListboxOption
                      key={status}
                      value={status}
                      className={({ active, selected }) =>
                        cn(
                          "relative cursor-pointer select-none px-4 py-2",
                          active ? "bg-muted text-foreground" : "text-muted-foreground",
                          selected && "font-medium text-foreground bg-muted/50"
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
        </div>

        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  );
}
