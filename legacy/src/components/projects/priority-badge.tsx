import type { Priority } from "@prisma/client";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/project-utils";
import { ArrowDown, Minus, ArrowUp, AlertOctagon, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  priority?: Priority | null;
  className?: string;
};

const PRIORITY_ICONS: Record<Priority, LucideIcon> = {
  LOW: ArrowDown,
  MEDIUM: Minus,
  HIGH: ArrowUp,
  URGENT: AlertOctagon,
};

export function PriorityBadge({ priority, className }: Props) {
  if (!priority) return null;

  const Icon = PRIORITY_ICONS[priority];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        PRIORITY_COLORS[priority],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
