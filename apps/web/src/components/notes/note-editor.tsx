"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import {
  Edit,
  Eye,
  Save,
  Trash2,
  Menu,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toastApiError } from "@/lib/api/error-toast";
import { toast } from "sonner";
import { brand, couldnt } from "@/lib/brand";

type NoteEditorProps = {
  noteId: string | null;
  initialTitle: string;
  initialContent: string;
  onSave: (
    id: string | undefined,
    title: string,
    content: string,
  ) => Promise<boolean>;
  onDelete: (id: string) => void;
  isSaving: boolean;
  isDeleting: boolean;
  onMenuToggle?: () => void;
};

export function NoteEditor({
  noteId,
  initialTitle,
  initialContent,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
  onMenuToggle,
}: NoteEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [previewMode, setPreviewMode] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // Refs for auto-save comparison
  const titleRef = useRef(title);
  const contentRef = useRef(content);

  useEffect(() => {
    titleRef.current = title;
    contentRef.current = content;
  }, [title, content]);

  // Reset state when noteId changes - use key prop pattern to avoid setState in effect
  const prevNoteIdRef = useRef(noteId);
  if (prevNoteIdRef.current !== noteId) {
    prevNoteIdRef.current = noteId;
    // Reset will happen naturally on next render due to useState initialization
  }

  // Sync with initialTitle/initialContent when they change externally
  useEffect(() => {
    if (title !== initialTitle || content !== initialContent) {
      // Only sync if we're not currently editing (not dirty)
      if (!isDirty) {
        setTitle(initialTitle);
        setContent(initialContent);
        setPreviewMode(initialContent.trim().length > 0);
        setIsEditingTitle(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    setIsDirty(true);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setIsDirty(true);
  };

  const handleSave = useCallback(async () => {
    const currentTitle = titleRef.current;
    const currentContent = contentRef.current;

    if (!currentTitle.trim()) return;

    try {
      const didSave = await onSave(noteId || undefined, currentTitle, currentContent);

      if (!didSave) {
        return;
      }

      // Only clear dirty flag if content hasn't changed during save
      if (
        titleRef.current === currentTitle &&
        contentRef.current === currentContent
      ) {
        setIsDirty(false);
        toast.success("Saved.");
      }
    } catch (error) {
      toastApiError(error, couldnt("save the note"));
    }
  }, [noteId, onSave]);

  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Save on unmount / id change
  useEffect(() => {
    return () => {
      if (isDirtyRef.current && noteId) {
        const titleToSave = titleRef.current;
        const contentToSave = contentRef.current;

        void onSave(noteId, titleToSave, contentToSave)
          .then((didSave) => {
            if (didSave) {
              toast.success("Saved.");
            }
          })
          .catch((error) => {
            toastApiError(error, couldnt("save the note"));
          });
      }
    };
  }, [noteId, onSave]);

  // Auto-save with 5s debounce
  useEffect(() => {
    if (!isDirty || !noteId || isSaving) return;

    const timeoutId = setTimeout(() => {
      handleSave();
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [title, content, isDirty, noteId, isSaving, handleSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  if (!noteId && !title && !content) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center">
        <div className="max-w-md space-y-4">
          <p className="text-lg font-medium">No note selected</p>
          <p className="text-sm">
            Choose a note, or capture a new one.
          </p>
          {onMenuToggle && (
            <Button
              variant="outline"
              onClick={onMenuToggle}
              className="sm:hidden"
            >
              Open {brand.terms.library}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 shrink-0 z-10">
        <div className="flex items-center gap-2">
          {onMenuToggle && (
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden -ml-2"
              onClick={onMenuToggle}
            >
              <Menu className="h-4 w-4" />
            </Button>
          )}
          {isEditingTitle ? (
            <Input
              value={title}
              onChange={handleTitleChange}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setIsEditingTitle(false);
              }}
              autoFocus
              placeholder="Title"
              className="text-lg font-semibold border-none shadow-none focus-visible:ring-0 px-0 h-auto bg-transparent placeholder:text-muted-foreground/50 w-[200px] sm:w-[300px] md:w-[400px]"
            />
          ) : (
            <div className="flex items-center gap-2 group">
              <span
                className="text-lg font-semibold truncate max-w-[200px] sm:max-w-[300px] md:max-w-[400px] cursor-pointer hover:opacity-70"
                onClick={() => setIsEditingTitle(true)}
              >
                {title || "Untitled note"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setIsEditingTitle(true)}
                title="Edit title"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <Toggle
            pressed={previewMode}
            onPressedChange={setPreviewMode}
            size="sm"
            className="h-8 gap-2"
            aria-label="Toggle preview"
          >
            {previewMode ? (
              <Eye className="h-4 w-4" />
            ) : (
              <Edit className="h-4 w-4" />
            )}
            <span className="sr-only sm:not-sr-only">
              {previewMode ? "Preview" : "Edit"}
            </span>
          </Toggle>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => noteId && onDelete(noteId)}
            className="h-8 text-destructive hover:text-destructive"
            disabled={!noteId || isDeleting}
            title="Delete note"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Delete</span>
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !title.trim() || (!isDirty && !!noteId)}
            className={cn(
              "h-8 transition-all",
              isDirty ? "opacity-100" : "opacity-70",
            )}
          >
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </div>

      {/* Editor/Preview Area */}
      <div className="flex-1 overflow-hidden relative">
        {previewMode ? (
          <div className="h-full w-full overflow-y-auto p-4 sm:p-8">
            <div className="max-w-none prose prose-sm dark:prose-invert mx-auto w-full">
              <ChatMarkdown content={content} />
            </div>
          </div>
        ) : (
          <Textarea
            value={content}
            onChange={handleContentChange}
            placeholder="Write in Markdown..."
            className="h-full w-full resize-none border-0 p-4 sm:p-8 focus-visible:ring-0 text-base font-mono leading-relaxed"
          />
        )}
      </div>
    </div>
  );
}
