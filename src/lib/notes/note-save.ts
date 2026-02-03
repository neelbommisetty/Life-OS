import { deriveNoteTitle } from "./note-utils";

type BuildNoteFromMessageInput = {
  userId: string;
  sourceMessageId: string;
  content: string;
  projectId: string | null;
};

export function buildNoteFromMessage(input: BuildNoteFromMessageInput) {
  return {
    userId: input.userId,
    sourceMessageId: input.sourceMessageId,
    title: deriveNoteTitle(input.content),
    content: input.content,
    projectId: input.projectId ?? null,
  };
}
