import { deriveNoteTitle } from "@/lib/notes/note-utils";

export function buildNoteSavePayload(title: string, content: string): {
  title: string;
  content: string;
} | null {
  const normalizedContent = content;
  const trimmedTitle = title.trim();
  const hasContent = normalizedContent.trim().length > 0;
  const normalizedTitle = trimmedTitle || (hasContent ? deriveNoteTitle(normalizedContent) : "");

  if (!normalizedTitle.trim()) {
    return null;
  }

  return {
    title: normalizedTitle,
    content: normalizedContent,
  };
}
