"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createNote, updateNote, deleteNote } from "@/lib/notes/actions";
import { toastApiError } from "@/lib/api/error-toast";
import type { Note, Project } from "@life-os/db";
import { NoteSelector, NoteEditor } from "@/components/notes";
import { FileText } from "lucide-react";
import { brand, couldnt } from "@/lib/brand";
import { buildNoteSavePayload } from "./note-create-utils";

type NoteWithProject = Note & { project: Project | null };

export function NotesClient({
  projectId,
  initialNotes = []
}: {
  projectId?: string;
  initialNotes?: NoteWithProject[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const noteIdParam = searchParams.get("noteId");

  const [notes, setNotes] = useState<NoteWithProject[]>(initialNotes);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  // "Creating new" state. If true, we show the editor with empty fields.
  // If false and no noteIdParam, we show empty state.
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const [isPending, startTransition] = useTransition();

  // Sync URL with selection
  const setNoteIdInUrl = useCallback(
    (noteId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (noteId) {
        params.set("noteId", noteId);
      } else {
        params.delete("noteId");
      }
      const url = `${pathname}?${params.toString()}`;
      router.push(url);
    },
    [pathname, router, searchParams],
  );

  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === noteIdParam) ?? null;
  }, [notes, noteIdParam]);

  // On the main notes page, keep a note selected when notes exist.
  useEffect(() => {
    if (pathname !== "/notes") return;
    if (isCreatingNew) return;
    if (notes.length === 0) return;
    if (activeNote) return;
    setNoteIdInUrl(notes[0].id);
  }, [pathname, isCreatingNew, notes, activeNote, setNoteIdInUrl]);

  // Derive isCreatingNew from noteIdParam to avoid setState in effect
  const effectiveIsCreatingNew = useMemo(
    () => isCreatingNew && !noteIdParam,
    [isCreatingNew, noteIdParam]
  );

  // Handlers
  const handleNoteSelect = (noteId: string) => {
    setNoteIdInUrl(noteId);
    setIsMobileDrawerOpen(false);
    setIsCreatingNew(false);
  };

  const handleCreateStart = () => {
    setIsCreatingNew(true);
    setNoteIdInUrl(null);
    setIsMobileDrawerOpen(false);
  };

  const handleSave = useCallback(
    (id: string | undefined, title: string, content: string): Promise<boolean> =>
      new Promise((resolve) => {
        startTransition(() => {
          void (async () => {
            try {
              const payload = buildNoteSavePayload(title, content);

              if (!payload) {
                resolve(false);
                return;
              }

              if (id) {
                const updated = await updateNote({ id, ...payload });
                setNotes((prev) =>
                  prev.map((n) => (n.id === id ? { ...n, ...updated } : n)),
                );
              } else {
                const created = await createNote({ ...payload, projectId });
                const newNote: NoteWithProject = { ...created, project: null };
                setNotes((prev) => [newNote, ...prev]);
                setNoteIdInUrl(created.id);
                setIsCreatingNew(false);
              }
              resolve(true);
            } catch (error) {
              toastApiError(error, couldnt("save the note"));
              resolve(false);
            }
          })();
        });
      }),
    [projectId, setNoteIdInUrl],
  );

  const handleDeleteClick = (id: string) => {
    setNoteToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!noteToDelete) return;
    startTransition(async () => {
      try {
        await deleteNote({ id: noteToDelete });
        setNotes((prev) => prev.filter((n) => n.id !== noteToDelete));
        if (noteIdParam === noteToDelete) {
          setNoteIdInUrl(null);
        }
        setDeleteDialogOpen(false);
        setNoteToDelete(null);
      } catch (error) {
        toastApiError(error, couldnt("delete the note"));
      }
    });
  };

  // Prepare data for selector
  const noteOptions = useMemo(() => {
    return notes.map((n) => ({
      id: n.id,
      title: n.title,
      updatedAt: n.updatedAt,
      project: n.project,
    }));
  }, [notes]);

  const showEditor = !!activeNote || effectiveIsCreatingNew;
  const editorKey = activeNote
    ? `${activeNote.id}:${activeNote.updatedAt.toISOString()}`
    : effectiveIsCreatingNew
      ? "draft-note"
      : "empty-note";

  return (
    <>
      <div className="hidden sm:grid h-full grid-cols-[minmax(240px,300px)_1fr] overflow-hidden">
        {/* Sidebar */}
        <div className="border-r border-border bg-muted/30 overflow-hidden h-full flex flex-col">
          <NoteSelector
            notes={noteOptions}
            value={activeNote?.id ?? null}
            onChange={handleNoteSelect}
            onCreate={handleCreateStart}
            onDelete={handleDeleteClick}
            isCreating={isPending} // reusing pending state
            isDeleting={isPending}
          />
        </div>

        {/* Main Area */}
        <div className="h-full overflow-hidden flex flex-col bg-background">
          {showEditor ? (
            <NoteEditor
              key={editorKey}
              noteId={activeNote?.id ?? null}
              initialTitle={activeNote?.title ?? ""}
              initialContent={activeNote?.content ?? ""}
              onSave={handleSave}
              onDelete={handleDeleteClick}
              isSaving={isPending}
              isDeleting={isPending}
              isCreatingNew={effectiveIsCreatingNew}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center">
              <div className="flex flex-col items-center gap-4 max-w-sm">
                <div className="p-4 bg-muted rounded-full">
                  <FileText className="h-8 w-8 text-muted-foreground/60" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-foreground">
                    No note selected
                  </h3>
                  <p className="text-sm mt-1">
                    Choose a note from the sidebar, or capture a new one.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="sm:hidden h-full flex flex-col overflow-hidden">
        {/* Mobile Header / Content */}
        {showEditor ? (
          <NoteEditor
            key={editorKey}
            noteId={activeNote?.id ?? null}
            initialTitle={activeNote?.title ?? ""}
            initialContent={activeNote?.content ?? ""}
            onSave={handleSave}
            onDelete={handleDeleteClick}
            isSaving={isPending}
            isDeleting={isPending}
            onMenuToggle={() => setIsMobileDrawerOpen(true)}
            isCreatingNew={effectiveIsCreatingNew}
          />
        ) : (
          <div className="flex-1 flex flex-col">
            {/* In mobile initial state (no selection), we show the selector directly or the empty state?
                   Usually mobile view is stack based. If no selection, show list.
                   If selection, show editor.
                   But here we want a consistent layout.
                   Let's use the Drawer to show the list if we are editing,
                   but if we are NOT editing, we should probably just show the list in the main view.
                   But to keep it simple and consistent with ChatClient mobile view:
                   ChatClient shows header + messages + input. Drawer is for threads.
                   So here: Header + Editor. Drawer for Notes.
                   If no note selected, show empty state with "Open Menu" button.
               */}
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center">
              <div className="flex flex-col items-center gap-4 max-w-sm">
                <div className="p-4 bg-muted rounded-full">
                  <FileText className="h-8 w-8 text-muted-foreground/60" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-foreground">
                    No note selected
                  </h3>
                  <p className="text-sm mt-1">
                    Open the menu to choose a note, or capture a new one.
                  </p>
                </div>
                <button
                  onClick={() => setIsMobileDrawerOpen(true)}
                  className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
                >
                  Open {brand.terms.library}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Drawer */}
      <Sheet open={isMobileDrawerOpen} onOpenChange={setIsMobileDrawerOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <NoteSelector
            notes={noteOptions}
            value={activeNote?.id ?? null}
            onChange={handleNoteSelect}
            onCreate={handleCreateStart}
            onDelete={handleDeleteClick}
            isCreating={isPending}
            isDeleting={isPending}
            isMobile
            onNoteSelect={() => setIsMobileDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this note? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
