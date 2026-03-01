"use client";

import {
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Search,
  X,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";

type NoteOption = {
  id: string;
  title: string;
  updatedAt: Date;
  project?: {
    id: string;
    name: string;
  } | null;
};

type Props = {
  notes: NoteOption[];
  value: string | null;
  onChange: (noteId: string) => void;
  onCreate: () => void;
  onDelete: () => void;
  isCreating?: boolean;
  isDeleting?: boolean;
  isMobile?: boolean;
  onNoteSelect?: () => void;
};

type NotesHeaderProps = {
  onCreate: () => void;
  isCreating?: boolean;
};

type NotesListProps = {
  directNotes: NoteOption[];
  projectNotes: Array<{
    project: { id: string; name: string };
    notes: NoteOption[];
  }>;
  value: string | null;
  onChange: (noteId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  showSearch: boolean;
  collapsedProjects: Set<string>;
  toggleProjectCollapse: (projectId: string) => void;
};

function NotesHeader({
  onCreate,
  isCreating,
}: NotesHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <FileText className="h-4 w-4" />
        {brand.terms.library}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onCreate}
          disabled={isCreating}
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Capture note"
          aria-label="Capture note"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function NotesList({
  directNotes,
  projectNotes,
  value,
  onChange,
  searchQuery,
  setSearchQuery,
  showSearch,
  collapsedProjects,
  toggleProjectCollapse,
}: NotesListProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      {/* Search */}
      {showSearch && (
        <div className="px-3 py-2 border-b border-border/50 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground z-10" />
            <Input
              type="text"
              placeholder="Search notes..."
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
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-2 space-y-4">
        {directNotes.length === 0 && projectNotes.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {searchQuery ? "No matching notes." : "No notes here yet. Capture one."}
          </div>
        ) : (
          <>
            {/* Direct Notes Section */}
            {directNotes.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  All Notes
                </div>
                {directNotes.map((note) => {
                  const isSelected = value === note.id;
                  return (
                    <div
                      key={note.id}
                      onClick={() => onChange(note.id)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors min-w-0",
                        isSelected
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <span className="truncate flex-1 text-left min-w-0">
                        {note.title || "Untitled note"}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-muted-foreground/60 whitespace-nowrap">
                          {formatRelativeTime(note.updatedAt)}
                        </span>
                        {isSelected && (
                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Project Notes Section */}
            {projectNotes.length > 0 && (
              <div className="space-y-2">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Project Notes
                </div>
                {projectNotes.map(({ project, notes: projectNoteList }) => {
                  const isCollapsed = collapsedProjects.has(project.id);
                  return (
                    <div key={project.id} className="space-y-0.5">
                      {/* Project Header */}
                      <button
                        onClick={() => toggleProjectCollapse(project.id)}
                        className="w-full flex items-center gap-2 px-2 py-1 text-xs font-medium text-foreground/80 hover:text-foreground transition-colors rounded-md hover:bg-muted/50"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="truncate flex-1 text-left">
                          {project.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {projectNoteList.length}
                        </span>
                      </button>

                      {/* Project Notes */}
                      {!isCollapsed &&
                        projectNoteList.map((note) => {
                          const isSelected = value === note.id;
                          return (
                            <div
                              key={note.id}
                              onClick={() => onChange(note.id)}
                              className={cn(
                                "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ml-4 min-w-0",
                                isSelected
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                              )}
                            >
                              <span className="truncate flex-1 text-left flex items-center gap-1.5 min-w-0">
                                <span className="text-muted-foreground/60 shrink-0">
                                  #
                                </span>
                                <span className="truncate">
                                  {note.title || "Untitled note"}
                                </span>
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[11px] text-muted-foreground/60 whitespace-nowrap">
                                  {formatRelativeTime(note.updatedAt)}
                                </span>
                                {isSelected && (
                                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
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

export function NoteSelector({
  notes,
  value,
  onChange,
  onCreate,
  isCreating,
  isMobile = false,
  onNoteSelect,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
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

  const { directNotes, projectNotes } = useMemo(() => {
    const filtered = searchQuery.trim()
      ? notes.filter((note) =>
          note.title.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : notes;

    const direct: NoteOption[] = [];
    const byProject: Record<
      string,
      { project: { id: string; name: string }; notes: NoteOption[] }
    > = {};

    for (const note of filtered) {
      if (!note.project) {
        direct.push(note);
      } else {
        if (!byProject[note.project.id]) {
          byProject[note.project.id] = {
            project: note.project,
            notes: [],
          };
        }
        byProject[note.project.id].notes.push(note);
      }
    }

    return {
      directNotes: direct,
      projectNotes: Object.values(byProject),
    };
  }, [notes, searchQuery]);

  const showSearch = notes.length > 5;

  const handleNoteChange = (noteId: string) => {
    onChange(noteId);
    onNoteSelect?.();
  };

  // Mobile drawer mode: render as single flex column
  if (isMobile) {
    return (
      <div className="flex h-full w-full flex-col bg-muted/30 overflow-hidden">
        <NotesHeader
          onCreate={onCreate}
          isCreating={isCreating}
        />
        <NotesList
          directNotes={directNotes}
          projectNotes={projectNotes}
          value={value}
          onChange={handleNoteChange}
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
  return (
    <>
      <NotesHeader
        onCreate={onCreate}
        isCreating={isCreating}
      />
      <NotesList
        directNotes={directNotes}
        projectNotes={projectNotes}
        value={value}
        onChange={handleNoteChange}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showSearch={showSearch}
        collapsedProjects={collapsedProjects}
        toggleProjectCollapse={toggleProjectCollapse}
      />
    </>
  );
}
