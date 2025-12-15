'use client';

import { projectStatusEnum } from '@/lib/validations/project';

type Props = {
  value: string | null;
  onChange: (status: string | null) => void;
};

const statuses = ["ALL", ...projectStatusEnum.options];

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
                ? "border-blue-500 bg-blue-100 text-blue-700"
                : "border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            {status === "ALL" ? "All" : status.replace("_", " ")}
          </button>
        );
      })}
    </div>
  );
}

