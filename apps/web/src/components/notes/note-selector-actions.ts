import { getNoteDisplayTitle } from "@/lib/notes/note-title";

export function getNoteSelectorActionLabels(title: string) {
  const displayTitle = getNoteDisplayTitle(title);

  return {
    delete: `Delete ${displayTitle}`,
  };
}
