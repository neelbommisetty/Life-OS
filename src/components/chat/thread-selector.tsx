"use client";

import {
  ArchiveIcon,
  LoaderIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const [searchQuery, setSearchQuery] = useState("");

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    return threads.filter((thread) =>
      thread.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [threads, searchQuery]);

  const showSearch = threads.length > 5;

  return (
    <div
      className={cn(
        "flex w-full flex-col bg-muted/30",
        layout === "stacked"
          ? "max-h-56 min-h-0 border-b border-border"
          : "border-b border-border sm:h-full sm:w-64 sm:border-b-0 sm:border-r"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <MessageSquareIcon className="h-4 w-4" />
          Threads
        </div>
        <div className="flex items-center gap-2">
          {value && (
            <Button
              type="button"
              onClick={onArchive}
              disabled={isArchiving || isLocked}
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Archive thread"
              aria-label="Archive thread"
            >
              <ArchiveIcon className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            onClick={onCreate}
            disabled={isCreating || isLocked}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="New thread"
            aria-label="Create new thread"
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="px-3 py-2 border-b border-border/50">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground z-10" />
            <Input
              type="text"
              placeholder="Search threads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-7 text-xs h-8"
            />
            {searchQuery && (
              <Button
                type="button"
                onClick={() => setSearchQuery("")}
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-sm p-0.5"
                aria-label="Clear search"
              >
                <XIcon className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-0.5">
        {filteredThreads.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {searchQuery ? "No matching threads found." : "No threads yet."}
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isSelected = value === thread.id;
            const showStreamingIndicator =
              isStreaming && streamingThreadId === thread.id;
            return (
              <div
                key={thread.id}
                onClick={() => !isLocked && onChange(thread.id)}
                className={cn(
                  "w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors",
                  isSelected
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  isLocked && "cursor-not-allowed opacity-60"
                )}
              >
                <span className="truncate flex-1 text-left">{thread.name}</span>
                {showStreamingIndicator ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin text-primary shrink-0 ml-2" />
                ) : (
                  isSelected && (
                    <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 ml-2" />
                  )
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
