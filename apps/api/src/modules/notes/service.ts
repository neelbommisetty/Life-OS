import {
  createNoteSchema,
  deleteNoteSchema,
  getNoteByIdSchema,
  listNotesSchema,
  saveMessageAsNoteSchema,
  updateNoteSchema,
  type CreateNoteInput,
  type DeleteNoteInput,
  type GetNoteByIdInput,
  type ListNotesInput,
  type SaveMessageAsNoteInput,
  type UpdateNoteInput,
} from "./schemas.js";
import { buildNoteFromMessage } from "./note-utils.js";

const NOTE_ORDER = [{ updatedAt: "desc" }] as const;

type NotesTransactionClient = {
  chatMessage: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    update: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  note: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export type NotesDb = {
  note: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  chatMessage: {
    updateMany: (args: unknown) => Promise<unknown>;
  };
  $transaction: <T>(callback: (tx: NotesTransactionClient) => Promise<T>) => Promise<T>;
};

export async function listNotes(params: {
  db: NotesDb;
  userId: string;
  input?: ListNotesInput;
}) {
  const parsed = listNotesSchema.parse(params.input ?? {});

  const where = {
    userId: params.userId,
    deletedAt: null,
    ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
    ...(parsed.search
      ? {
          OR: [
            {
              title: {
                contains: parsed.search,
                mode: "insensitive",
              },
            },
            {
              content: {
                contains: parsed.search,
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };

  return params.db.note.findMany({
    where,
    orderBy: NOTE_ORDER,
    include: {
      project: true,
    },
  });
}

export async function getNoteById(params: {
  db: NotesDb;
  userId: string;
  input: GetNoteByIdInput;
}) {
  const parsed = getNoteByIdSchema.parse(params.input);

  const note = await params.db.note.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
      deletedAt: null,
    },
  });

  if (!note) {
    throw new Error("Note not found");
  }

  return note;
}

export async function createNote(params: {
  db: NotesDb;
  userId: string;
  input?: CreateNoteInput;
}) {
  const parsed = createNoteSchema.parse(params.input ?? {});

  return params.db.note.create({
    data: {
      userId: params.userId,
      title: parsed.title,
      content: parsed.content,
      projectId: parsed.projectId,
    },
  });
}

export async function saveMessageAsNote(params: {
  db: NotesDb;
  userId: string;
  input: SaveMessageAsNoteInput;
}) {
  const parsed = saveMessageAsNoteSchema.parse(params.input);

  return params.db.$transaction(async (tx) => {
    const message = (await tx.chatMessage.findFirst({
      where: {
        id: parsed.messageId,
        thread: {
          userId: params.userId,
        },
      },
      include: {
        thread: {
          select: {
            projectId: true,
          },
        },
      },
    })) as
      | {
          id: string;
          role: string;
          content: string;
          savedNoteId: string | null;
          thread: {
            projectId: string | null;
          };
        }
      | null;

    if (!message) {
      throw new Error("Message not found");
    }

    if (message.role !== "ASSISTANT") {
      throw new Error("Only assistant messages can be saved as notes");
    }

    const existingNote = (await tx.note.findFirst({
      where: {
        userId: params.userId,
        deletedAt: null,
        sourceMessageId: message.id,
      },
    })) as { id: string } | null;

    if (existingNote) {
      if (message.savedNoteId !== existingNote.id) {
        await tx.chatMessage.update({
          where: { id: message.id },
          data: { savedNoteId: existingNote.id },
        });
      }

      return { note: existingNote, alreadySaved: true };
    }

    const note = (await tx.note.create({
      data: buildNoteFromMessage({
        userId: params.userId,
        sourceMessageId: message.id,
        content: message.content,
        projectId: message.thread.projectId ?? null,
      }),
    })) as { id: string };

    await tx.chatMessage.update({
      where: { id: message.id },
      data: { savedNoteId: note.id },
    });

    return { note, alreadySaved: false };
  });
}

export async function updateNote(params: {
  db: NotesDb;
  userId: string;
  input: UpdateNoteInput;
}) {
  const parsed = updateNoteSchema.parse(params.input);

  const existingNote = await params.db.note.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!existingNote) {
    throw new Error("Note not found");
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.title !== undefined) updateData.title = parsed.title;
  if (parsed.content !== undefined) updateData.content = parsed.content;

  return params.db.note.update({
    where: { id: parsed.id },
    data: updateData,
  });
}

export async function deleteNote(params: {
  db: NotesDb;
  userId: string;
  input: DeleteNoteInput;
}) {
  const parsed = deleteNoteSchema.parse(params.input);

  const existingNote = (await params.db.note.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
      deletedAt: null,
    },
    select: {
      id: true,
      sourceMessageId: true,
    },
  })) as { id: string } | null;

  if (!existingNote) {
    throw new Error("Note not found");
  }

  await params.db.$transaction(async (tx) => {
    await tx.note.update({
      where: { id: parsed.id },
      data: {
        deletedAt: new Date(),
      },
    });

    await tx.chatMessage.updateMany({
      where: {
        savedNoteId: existingNote.id,
      },
      data: {
        savedNoteId: null,
      },
    });
  });

  return { success: true };
}
