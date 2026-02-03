const FALLBACK_TITLE = "Saved from chat";
const MAX_TITLE_LENGTH = 500;

export function deriveNoteTitle(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const title = firstLine && firstLine.length > 0 ? firstLine : FALLBACK_TITLE;
  return title.slice(0, MAX_TITLE_LENGTH);
}
