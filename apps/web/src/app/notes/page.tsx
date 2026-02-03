import { redirect } from "next/navigation";
import { authServer } from "@/lib/auth/server";
import { NotesClient } from "./notes-client";
import { listNotes } from "@/lib/notes/actions";
import { Suspense } from "react";
import { NotesSkeleton } from "./notes-skeleton";

export default async function NotesPage() {
  const { data: session } = await authServer.getSession();

  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  // Pre-fetch notes on the server
  const notes = await listNotes();

  return (
    <Suspense fallback={<NotesSkeleton />}>
      <NotesClient initialNotes={notes} />
    </Suspense>
  );
}
