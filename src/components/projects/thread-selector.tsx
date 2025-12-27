"use client";

import {
  ArchiveIcon,
  LoaderIcon,
  MessageSquareIcon,
  PlusIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ThreadOption = {
  id: string;
  name: string;
};

type Props = {
  threads: ThreadOption[];
  value: string | null;
  onChange: (threadId: string) => void;
  onCreate: () => void;
  onArchive: () => void;
  isCreating?: boolean;
  isArchiving?: boolean;
  isLocked?: boolean;
  isStreaming?: boolean;
  streamingThreadId?: string | null;
  layout?: "side" | "stacked";
};

export function ThreadSelector({
  threads,
  value,
  onChange,
  onCreate,
  onArchive,
  isCreating,
  isArchiving,
  isLocked,
  isStreaming,
  streamingThreadId,
  layout = "side",
}: Props) {
  return (
    <div
      className={cn(
        "flex w-full flex-col bg-muted/30",
        layout === "stacked"
          ? "max-h-56 min-h-0 border-b border-border"
          : "border-b border-border sm:h-full sm:w-64 sm:border-b-0 sm:border-r"
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <MessageSquareIcon className="h-4 w-4" />
          Threads
        </div>
        <div className="flex items-center gap-2">
          {value && (
            <button
              type="button"
              onClick={onArchive}
              disabled={isArchiving || isLocked}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition",
                "hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
              title="Archive thread"
              aria-label="Archive thread"
            >
              <ArchiveIcon className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onCreate}
            disabled={isCreating || isLocked}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition",
              "hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
            title="New thread"
            aria-label="Create new thread"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {threads.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
            No threads yet.
          </div>
        )}
        {threads.map((thread) => {
          const label = formatThreadLabel(thread.name);
          const isSelected = value === thread.id;
          const showStreaming =
            isStreaming && streamingThreadId === thread.id;
          return (
            <button
              key={thread.id}
              onClick={() => onChange(thread.id)}
              disabled={isLocked}
              className={cn(
                "group w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-all",
                isSelected
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                isLocked && "cursor-not-allowed opacity-60"
              )}
            >
              <span className="truncate flex-1">{label}</span>
              {showStreaming ? (
                <LoaderIcon className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
              ) : (
                isSelected && (
                  <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                )
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatThreadLabel(name: string) {
  if (name.startsWith("Task:") && name.includes("::")) {
    const [, tail] = name.split("::");
    return tail?.trim() || "Task brainstorm";
  }
  return name;
}
