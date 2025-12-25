"use client";

import { Listbox } from "@headlessui/react";
import { useMemo } from "react";
import {
  ArchiveIcon,
  ChevronDownIcon,
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
  const activeLabel = useMemo(() => {
    if (!value) return "Select thread";
    const activeThread = threads.find((thread) => thread.id === value);
    return formatThreadLabel(activeThread?.name ?? "Thread");
  }, [threads, value]);

  return (
    <div
      className={cn(
        "flex w-full flex-col bg-muted/30",
        layout === "stacked"
          ? "max-h-56 min-h-0 border-b border-border"
          : "border-b border-border sm:h-full sm:w-64 sm:border-b-0 sm:border-r"
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
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

      <div className="p-3">
        <Listbox value={value ?? ""} onChange={onChange} disabled={isLocked}>
          {({ open }) => (
            <div className="relative">
              <Listbox.Button
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm text-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30",
                  isLocked && "cursor-not-allowed opacity-60"
                )}
              >
                <span className="truncate">{activeLabel}</span>
                <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
              </Listbox.Button>

              <Listbox.Options
                className={cn(
                  "absolute z-20 mt-2 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg",
                  open ? "opacity-100" : "pointer-events-none opacity-0"
                )}
              >
                {threads.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No threads yet.
                  </div>
                )}
                {threads.map((thread) => {
                  const label = formatThreadLabel(thread.name);
                  const showStreaming =
                    isStreaming && streamingThreadId === thread.id;
                  return (
                    <Listbox.Option key={thread.id} value={thread.id}>
                      {({ active, selected }) => (
                        <div
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm",
                            selected
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground",
                            active && "bg-muted/70 text-foreground"
                          )}
                        >
                          <span className="truncate">{label}</span>
                          {showStreaming && (
                            <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      )}
                    </Listbox.Option>
                  );
                })}
              </Listbox.Options>
            </div>
          )}
        </Listbox>
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
