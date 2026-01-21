import { redirect, notFound } from "next/navigation";
import { authServer } from "@/lib/auth/server";
import { getNoteById } from "@/lib/notes/actions";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit, Trash2 } from "lucide-react";
import Link from "next/link";
import { NoteActions } from "./note-actions";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function NoteDetailPage({ params }: Props) {
  const { data: session } = await authServer.getSession();

  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const { id } = await params;

  let note;
  try {
    note = await getNoteById({ id });
  } catch (error) {
    notFound();
  }

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <Link href="/notes">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Notes
          </Button>
        </Link>
        <NoteActions noteId={note.id} noteTitle={note.title} />
      </div>

      {/* Note Content */}
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {note.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            Updated {new Date(note.updatedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ChatMarkdown content={note.content || ""} />
        </div>
      </div>
    </div>
  );
}
