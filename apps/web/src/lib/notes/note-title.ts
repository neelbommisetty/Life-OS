const FALLBACK_NOTE_TITLE = "Untitled note";

export function getNoteDisplayTitle(title: string | null | undefined) {
  const trimmedTitle = title?.trim();
  return trimmedTitle && trimmedTitle.length > 0
    ? trimmedTitle
    : FALLBACK_NOTE_TITLE;
}
