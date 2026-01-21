"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, Trash2, Edit, FileText, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  getNoteById,
} from "@/lib/notes/actions";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import type { Note } from "@prisma/client";

type NoteDraft = {
  id?: string;
  title: string;
  content: string;
};

function createEmptyDraft(): NoteDraft {
  return {
    title: "",
    content: "",
  };
}

export function NotesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>(createEmptyDraft());
  const [previewMode, setPreviewMode] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [isCreating, startCreateTransition] = useTransition();
  const [isUpdating, startUpdateTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const isEdit = !!draft.id;

  // Load notes
  const loadNotes = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listNotes({
        search: search || undefined,
      });
      setNotes(result);
    } catch (error) {
      console.error("Failed to load notes:", error);
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Handlers
  const handleCreate = () => {
    setDraft(createEmptyDraft());
    setPreviewMode(false);
    setSheetOpen(true);
  };

  const handleEdit = (note: Note) => {
    setDraft({
      id: note.id,
      title: note.title,
      content: note.content,
    });
    setPreviewMode(false);
    setSheetOpen(true);
  };

  // Handle edit query parameter
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId && notes.length > 0) {
      const noteToEdit = notes.find((n) => n.id === editId);
      if (noteToEdit) {
        setDraft({
          id: noteToEdit.id,
          title: noteToEdit.title,
          content: noteToEdit.content,
        });
        setSheetOpen(true);
        // Remove query parameter from URL
        router.replace("/notes", { scroll: false });
      }
    }
  }, [searchParams, notes, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;

    if (isEdit && draft.id) {
      startUpdateTransition(async () => {
        try {
          await updateNote({
            id: draft.id!,
            title: draft.title.trim(),
            content: draft.content,
          });
          setSheetOpen(false);
          await loadNotes();
        } catch (error) {
          console.error("Failed to update note:", error);
        }
      });
    } else {
      startCreateTransition(async () => {
        try {
          await createNote({
            title: draft.title.trim(),
            content: draft.content,
          });
          setSheetOpen(false);
          await loadNotes();
        } catch (error) {
          console.error("Failed to create note:", error);
        }
      });
    }
  };

  const handleDeleteClick = (note: Note) => {
    setNoteToDelete(note);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!noteToDelete) return;
    startDeleteTransition(async () => {
      try {
        await deleteNote({ id: noteToDelete.id });
        setDeleteDialogOpen(false);
        setNoteToDelete(null);
        await loadNotes();
      } catch (error) {
        console.error("Failed to delete note:", error);
      }
    });
  };

  const filteredNotes = notes;

  return (
    <div className="container mx-auto max-w-6xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notes</h1>
          <p className="text-muted-foreground mt-1">
            Capture your thoughts, ideas, and information in Markdown
          </p>
        </div>
        <Button onClick={handleCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          New Note
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes..."
          className="pl-9"
        />
      </div>

      {/* Notes List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredNotes.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">
              {search
                ? "No notes match your search"
                : "No notes yet. Create your first note to get started!"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredNotes.map((note) => (
            <Card key={note.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <Link
                        href={`/notes/${note.id}`}
                        className="font-semibold text-lg hover:underline"
                      >
                        {note.title}
                      </Link>
                    </div>
                    {note.content && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {note.content.substring(0, 200)}
                        {note.content.length > 200 ? "..." : ""}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        Updated {new Date(note.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(note)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteClick(note)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Sheet */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setPreviewMode(false);
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-2xl">
          <form onSubmit={handleSave} className="flex flex-col h-full">
            <SheetHeader>
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle>{isEdit ? "Edit Note" : "Create Note"}</SheetTitle>
                  <SheetDescription>
                    {isEdit
                      ? "Update your note below"
                      : "Fill in the details to create a new note"}
                  </SheetDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewMode(!previewMode)}
                  className="ml-4"
                >
                  {previewMode ? (
                    <>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Preview
                    </>
                  )}
                </Button>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-4 py-6 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-sm font-medium">Title *</label>
                <Input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  placeholder="Note title"
                  required
                  disabled={previewMode}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Content {previewMode ? "(Preview)" : "(Markdown)"}
                  </label>
                </div>
                {previewMode ? (
                  <div className="min-h-[400px] rounded-md border border-input bg-background p-4 prose prose-sm dark:prose-invert max-w-none">
                    <ChatMarkdown content={draft.content || ""} />
                  </div>
                ) : (
                  <Textarea
                    value={draft.content}
                    onChange={(e) =>
                      setDraft({ ...draft, content: e.target.value })
                    }
                    placeholder="Write your note in Markdown..."
                    rows={20}
                    className="font-mono text-sm"
                  />
                )}
              </div>
            </div>

            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSheetOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || isUpdating || !draft.title.trim()}
              >
                {isCreating || isUpdating
                  ? "Saving..."
                  : isEdit
                  ? "Save Changes"
                  : "Create Note"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{noteToDelete?.title}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
