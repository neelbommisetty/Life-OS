import type { Metadata } from "next";
import { NotesClient } from "./notes-client";
import { listNotes } from "@/lib/notes/actions";
import { Suspense } from "react";
import { NotesSkeleton } from "./notes-skeleton";
import { requireApiSessionUser } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Notes",
  description: "Create, edit, and organize your notes.",
};

export default async function NotesPage() {
  await requireApiSessionUser();

  // Pre-fetch notes on the server
  const notes = await listNotes();

  return (
    <Suspense fallback={<NotesSkeleton />}>
      <NotesClient initialNotes={notes} />
    </Suspense>
  );
}
