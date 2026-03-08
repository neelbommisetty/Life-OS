import { deriveNoteTitle } from "@/lib/notes/note-utils";

export function buildNoteSavePayload(title: string, content: string): {
  title: string;
  content: string;
} | null {
  const normalizedContent = content;
  const normalizedTitle = title.trim() || deriveNoteTitle(normalizedContent);

  if (!normalizedTitle.trim()) {
    return null;
  }

  return {
    title: normalizedTitle,
    content: normalizedContent,
  };
}
