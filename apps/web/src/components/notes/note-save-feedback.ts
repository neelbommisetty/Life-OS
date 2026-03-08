export type NoteSaveReason = "manual" | "autosave" | "switch";

export function getNoteSaveSuccessMessage(reason: NoteSaveReason) {
  return reason === "manual" ? "Saved." : null;
}
