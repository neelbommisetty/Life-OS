import type { StatusHistory } from "@prisma/client";
import { formatDate, STATUS_LABELS } from "@/lib/project-utils";

type Props = {
  history: StatusHistory[];
};

export function StatusTimeline({ history }: Props) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No status changes yet. Updates will appear here.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-zinc-200 pl-4">
      {history.map((item) => (
        <li key={item.id} className="space-y-1">
          <div className="absolute -left-[7px] h-3 w-3 rounded-full border border-white bg-zinc-400 shadow" />
          <p className="text-sm font-semibold text-zinc-800">
            {STATUS_LABELS[item.status]}
          </p>
          <p className="text-xs text-zinc-500">
            {formatDate(item.timestamp)}
          </p>
        </li>
      ))}
    </ol>
  );
}

