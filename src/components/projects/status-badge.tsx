import type { ProjectStatus } from "@prisma/client";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/project-utils";

type Props = {
  status: ProjectStatus;
  className?: string;
};

export function StatusBadge({ status, className }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${STATUS_COLORS[status]} ${className ?? ""}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

