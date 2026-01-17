'use client';

import type { ProjectStatus } from "@prisma/client";
import { projectStatusEnum } from "@/lib/validations/project";

type Props = {
  value: ProjectStatus | null;
  onChange: (status: ProjectStatus | null) => void;
};

const STATUS_VALUES = projectStatusEnum.options as unknown as ProjectStatus[];
const statuses: (ProjectStatus | "ALL")[] = ["ALL", ...STATUS_VALUES];

export function StatusFilter({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {statuses.map((status) => {
        const isActive = value === (status === "ALL" ? null : status);
        return (
          <button
            key={status}
            onClick={() => onChange(status === "ALL" ? null : status)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition hover:-translate-y-0.5 hover:shadow ${
              isActive
                ? "border-blue-500 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {status === "ALL" ? "All" : status.replace("_", " ")}
          </button>
        );
      })}
    </div>
  );
}

