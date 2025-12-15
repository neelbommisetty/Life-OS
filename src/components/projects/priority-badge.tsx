import type { Priority } from "@prisma/client";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/project-utils";

type Props = {
  priority?: Priority | null;
};

export function PriorityBadge({ priority }: Props) {
  if (!priority) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${PRIORITY_COLORS[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

