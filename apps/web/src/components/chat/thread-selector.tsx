"use client";

import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ThreadOption = {
  id: string;
  name: string;
  lastChattedAt: Date;
  project?: {
    id: string;
    name: string;
  } | null;
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
  isMobile?: boolean;
  onThreadSelect?: () => void;
};

type ThreadsHeaderProps = {
  value: string | null;
  onArchive: () => void;
  onCreate: () => void;
  isArchiving?: boolean;
  isCreating?: boolean;
  isLocked?: boolean;
};

type ThreadsListProps = {
  directChats: ThreadOption[];
  projectThreads: Array<{
    project: { id: string; name: string };
    threads: ThreadOption[];
  }>;
  value: string | null;
  onChange: (threadId: string) => void;
  isLocked?: boolean;
  isStreaming?: boolean;
  streamingThreadId?: string | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  showSearch: boolean;
  collapsedProjects: Set<string>;
  toggleProjectCollapse: (projectId: string) => void;
};

function ThreadsHeader({
  value,
  onArchive,
  onCreate,
  isArchiving,
  isCreating,
  isLocked,
}: ThreadsHeaderProps) {
  return (
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
  );
}

function ThreadsList({
  directChats,
  projectThreads,
  value,
  onChange,
  isLocked,
  isStreaming,
  streamingThreadId,
  searchQuery,
  setSearchQuery,
  showSearch,
  collapsedProjects,
  toggleProjectCollapse,
}: ThreadsListProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      {/* Search */}
      {showSearch && (
        <div className="px-3 py-2 border-b border-border/50 shrink-0">
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
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-2 space-y-4">
      {directChats.length === 0 && projectThreads.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
          {searchQuery ? "No matching threads found." : "No threads yet."}
        </div>
      ) : (
        <>
          {/* Direct Chats Section */}
          {directChats.length > 0 && (
            <div className="space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Direct Chats
              </div>
              {directChats.map((thread) => {
                const isSelected = value === thread.id;
                const showStreamingIndicator =
                  isStreaming && streamingThreadId === thread.id;
                return (
                  <div
                    key={thread.id}
                    onClick={() => !isLocked && onChange(thread.id)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors min-w-0",
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      isLocked && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <span className="truncate flex-1 text-left min-w-0">
                      {thread.name}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-muted-foreground/60 whitespace-nowrap">
                        {formatRelativeTime(thread.lastChattedAt)}
                      </span>
                      {showStreamingIndicator ? (
                        <LoaderIcon className="h-3.5 w-3.5 animate-spin text-primary" />
                      ) : (
                        isSelected && (
                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Project Threads Section */}
          {projectThreads.length > 0 && (
            <div className="space-y-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Project Threads
              </div>
              {projectThreads.map(({ project, threads: projectThreadList }) => {
                const isCollapsed = collapsedProjects.has(project.id);
                return (
                  <div key={project.id} className="space-y-0.5">
                    {/* Project Header */}
                    <button
                      onClick={() => toggleProjectCollapse(project.id)}
                      className="w-full flex items-center gap-2 px-2 py-1 text-xs font-medium text-foreground/80 hover:text-foreground transition-colors rounded-md hover:bg-muted/50"
                    >
                      {isCollapsed ? (
                        <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate flex-1 text-left">
                        {project.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {projectThreadList.length}
                      </span>
                    </button>

                    {/* Project Threads */}
                    {!isCollapsed &&
                      projectThreadList.map((thread) => {
                        const isSelected = value === thread.id;
                        const showStreamingIndicator =
                          isStreaming && streamingThreadId === thread.id;
                        return (
                          <div
                            key={thread.id}
                            onClick={() => !isLocked && onChange(thread.id)}
                            className={cn(
                              "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ml-4 min-w-0",
                              isSelected
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                              isLocked && "cursor-not-allowed opacity-60"
                            )}
                          >
                            <span className="truncate flex-1 text-left flex items-center gap-1.5 min-w-0">
                              <span className="text-muted-foreground/60 shrink-0">#</span>
                              <span className="truncate">{thread.name}</span>
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-muted-foreground/60 whitespace-nowrap">
                                {formatRelativeTime(thread.lastChattedAt)}
                              </span>
                              {showStreamingIndicator ? (
                                <LoaderIcon className="h-3.5 w-3.5 animate-spin text-primary" />
                              ) : (
                                isSelected && (
                                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                                )
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
    </div>
  );
}

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
  isMobile = false,
  onThreadSelect,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set()
  );

  const toggleProjectCollapse = (projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const { directChats, projectThreads } = useMemo(() => {
    const filtered = searchQuery.trim()
      ? threads.filter((thread) =>
          thread.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : threads;

    const direct: ThreadOption[] = [];
    const byProject: Record<
      string,
      { project: { id: string; name: string }; threads: ThreadOption[] }
    > = {};

    for (const thread of filtered) {
      if (!thread.project) {
        direct.push(thread);
      } else {
        if (!byProject[thread.project.id]) {
          byProject[thread.project.id] = {
            project: thread.project,
            threads: [],
          };
        }
        byProject[thread.project.id].threads.push(thread);
      }
    }

    return {
      directChats: direct,
      projectThreads: Object.values(byProject),
    };
  }, [threads, searchQuery]);

  const showSearch = threads.length > 5;

  const handleThreadChange = (threadId: string) => {
    onChange(threadId);
    onThreadSelect?.();
  };

  // Mobile drawer mode: render as single flex column
  if (isMobile) {
    return (
      <div className="flex h-full w-full flex-col bg-muted/30 overflow-hidden">
        <ThreadsHeader
          value={value}
          onArchive={onArchive}
          onCreate={onCreate}
          isArchiving={isArchiving}
          isCreating={isCreating}
          isLocked={isLocked}
        />
        <ThreadsList
          directChats={directChats}
          projectThreads={projectThreads}
          value={value}
          onChange={handleThreadChange}
          isLocked={isLocked}
          isStreaming={isStreaming}
          streamingThreadId={streamingThreadId}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showSearch={showSearch}
          collapsedProjects={collapsedProjects}
          toggleProjectCollapse={toggleProjectCollapse}
        />
      </div>
    );
  }

  // Stacked layout (legacy, if needed)
  if (layout === "stacked") {
    return (
      <div className="flex w-full flex-col bg-muted/30 overflow-hidden max-h-56 min-h-0 border-b border-border">
        <ThreadsHeader
          value={value}
          onArchive={onArchive}
          onCreate={onCreate}
          isArchiving={isArchiving}
          isCreating={isCreating}
          isLocked={isLocked}
        />
        <ThreadsList
          directChats={directChats}
          projectThreads={projectThreads}
          value={value}
          onChange={handleThreadChange}
          isLocked={isLocked}
          isStreaming={isStreaming}
          streamingThreadId={streamingThreadId}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showSearch={showSearch}
          collapsedProjects={collapsedProjects}
          toggleProjectCollapse={toggleProjectCollapse}
        />
      </div>
    );
  }

  // Desktop grid mode: render as separate grid children (for parent to consume)
  // This returns a fragment so parent can place each child in its grid area
  return (
    <>
      <ThreadsHeader
        value={value}
        onArchive={onArchive}
        onCreate={onCreate}
        isArchiving={isArchiving}
        isCreating={isCreating}
        isLocked={isLocked}
      />
      <ThreadsList
        directChats={directChats}
        projectThreads={projectThreads}
        value={value}
        onChange={handleThreadChange}
        isLocked={isLocked}
        isStreaming={isStreaming}
        streamingThreadId={streamingThreadId}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showSearch={showSearch}
        collapsedProjects={collapsedProjects}
        toggleProjectCollapse={toggleProjectCollapse}
      />
    </>
  );
}

// Export sub-components for direct use in grid layouts
export { ThreadsHeader, ThreadsList };
