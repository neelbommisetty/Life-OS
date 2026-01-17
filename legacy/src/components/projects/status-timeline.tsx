import type { StatusHistory } from "@prisma/client";
import { formatDate, STATUS_LABELS } from "@/lib/project-utils";
import { cn } from "@/lib/utils";
import { getProjectTheme } from "@/lib/project-theme";

type Props = {
  history: StatusHistory[];
  accentColor?: string | null;
};

export function StatusTimeline({ history, accentColor }: Props) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No status changes yet. Updates will appear here.
      </p>
    );
  }

  const themeStyle = getProjectTheme(accentColor);
  const hasColor = !!accentColor;

  return (
    <ol
      className="relative space-y-4 border-l border-border pl-4"
      style={themeStyle}
    >
      {history.map((item) => (
        <li key={item.id} className="space-y-1">
          <div
            className={cn(
              "absolute -left-[7px] h-3 w-3 rounded-full border border-background shadow",
              hasColor ? "bg-[rgb(var(--project-accent))]" : "bg-muted-foreground"
            )}
          />
          <p className="text-sm font-semibold text-foreground">
            {STATUS_LABELS[item.status]}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(item.timestamp)}
          </p>
        </li>
      ))}
    </ol>
  );
}

