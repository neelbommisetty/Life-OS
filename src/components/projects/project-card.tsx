'use client';

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import type { Project } from '@prisma/client';
import Link from 'next/link';
import { useMemo } from 'react';
import { formatDate, STATUS_LABELS } from '@/lib/project-utils';
import { projectStatusEnum } from '@/lib/validations/project';
import { api } from '@/trpc/client';
import { PriorityBadge } from './priority-badge';
import { StatusBadge } from './status-badge';

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

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {project.icon ? <span className="text-lg">{project.icon}</span> : null}
          <h3 className="text-lg font-semibold text-zinc-900">{project.name}</h3>
        </div>
        <StatusBadge status={project.status} />
      </div>

      {project.description ? (
        <p className="mt-2 text-sm text-zinc-600 line-clamp-3">
          {project.description}
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No description yet.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={project.priority} />
        {project.tags?.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700"
          >
            #{tag}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
        <span>Last updated {formatDate(project.updatedAt)}</span>
        {project.dueDate ? <span>Due {formatDate(project.dueDate)}</span> : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Listbox
          value={project.status}
          onChange={(status) =>
            statusMutation.mutate({ id: project.id, status })
          }
        >
          <div className="relative w-full">
            <ListboxButton className="relative w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm font-medium text-zinc-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-black">
              Quick status
            </ListboxButton>
            <ListboxOptions className="absolute z-20 mt-2 w-full rounded-md border border-zinc-200 bg-white shadow-lg focus:outline-none">
              {statusOptions.map((status) => (
                <ListboxOption
                  key={status}
                  value={status}
                  className="cursor-pointer px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 ui-selected:bg-zinc-100 ui-selected:font-semibold"
                >
                  {STATUS_LABELS[status]}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>

        <Link
          href={`/projects/${project.id}`}
          className="shrink-0 rounded-md border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
        >
          Open
        </Link>
      </div>
    </div>
  );
}

