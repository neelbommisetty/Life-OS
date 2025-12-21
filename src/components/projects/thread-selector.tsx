"use client";

import { ArchiveIcon, LoaderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
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
}: Props) {
  return (
    <div className="flex w-full flex-col border-b border-border bg-muted/30 sm:h-full sm:w-64 sm:border-b-0 sm:border-r">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <MessageSquareIcon className="h-4 w-4" />
          Threads
        </div>
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
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {threads.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            No threads yet.
          </div>
        )}
        {threads.map((thread) => {
          const isActive = thread.id === value;
          const showStreaming =
            isStreaming && streamingThreadId === thread.id;
          return (
            <div key={thread.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange(thread.id)}
                disabled={isLocked}
                className={cn(
                  "flex-1 truncate rounded-md px-3 py-2 text-left text-sm transition",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
                title={thread.name}
              >
                {thread.name}
              </button>
              {showStreaming && (
                <span
                  className="flex h-8 w-8 items-center justify-center text-muted-foreground"
                  title="Generating response"
                >
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                </span>
              )}
              {isActive && (
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
                >
                  <ArchiveIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
