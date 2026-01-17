import type { ProjectStatus } from "@prisma/client";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/project-utils";
import {
  Lightbulb,
  Play,
  Rocket,
  CheckCircle,
  Archive,
  Clock,
  XCircle,
  LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  status: ProjectStatus;
  className?: string;
};

const STATUS_ICONS: Record<ProjectStatus, LucideIcon> = {
  IDEA: Lightbulb,
  IN_PROGRESS: Play,
  MVP: Rocket,
  COMPLETE: CheckCircle,
  ARCHIVE: Archive,
  DEFER: Clock,
  NOT_INTERESTED: XCircle,
};

export function StatusBadge({ status, className }: Props) {
  const Icon = STATUS_ICONS[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        STATUS_COLORS[status],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {STATUS_LABELS[status]}
    </span>
  );
}
