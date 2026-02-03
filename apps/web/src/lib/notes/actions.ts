"use server";

import { prisma } from "@/lib/db";
import { authServer } from "@/lib/auth/server";
import { createLogger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import {
  listNotesSchema,
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  getNoteByIdSchema,
  saveMessageAsNoteSchema,
  type ListNotesInput,
  type CreateNoteInput,
  type UpdateNoteInput,
  type DeleteNoteInput,
  type GetNoteByIdInput,
  type SaveMessageAsNoteInput,
} from "./validations";
import { buildNoteFromMessage } from "./note-save";

import { cache } from "react";

const logger = createLogger("notes:actions");

const NOTE_ORDER: Prisma.NoteOrderByWithRelationInput[] = [
  { updatedAt: "desc" },
];

/**
 * Get the current authenticated user ID
 */
const getCurrentUserId = cache(async (): Promise<string> => {
  const { data: session } = await authServer.getSession();

  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please sign in to continue");
  }

  return session.user.id;
});

/**
 * List notes for the current user
 */
export async function listNotes(input?: ListNotesInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = listNotesSchema.parse(input ?? {});

  logger.debug("Listing notes", {
    userId,
    hasSearch: !!parsed.search,
  });

  const where: Prisma.NoteWhereInput = {
    userId,
    deletedAt: null, // Exclude soft-deleted notes
    ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
    ...(parsed.search
      ? {
          OR: [
            { title: { contains: parsed.search, mode: "insensitive" } },
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

  const notes = await prisma.note.findMany({
    where,
    orderBy: NOTE_ORDER,
    include: {
      project: true,
    },
  });

  logger.info("Notes listed successfully", {
    userId,
    count: notes.length,
    durationMs: Date.now() - start,
  });

  return notes;
}

/**
 * Get a note by ID (validates ownership)
 */
export async function getNoteById(input: GetNoteByIdInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = getNoteByIdSchema.parse(input);

  logger.debug("Getting note by id", {
    userId,
    noteId: parsed.id,
  });

  const note = await prisma.note.findFirst({
    where: {
      id: parsed.id,
      userId,
      deletedAt: null,
    },
  });

  if (!note) {
    logger.warn("Note not found", {
      userId,
      noteId: parsed.id,
    });
    throw new Error("Note not found");
  }

  logger.info("Note retrieved successfully", {
    noteId: parsed.id,
    userId,
    durationMs: Date.now() - start,
  });

  return note;
}

/**
 * Create a new note for the current user
 */
export async function createNote(input?: CreateNoteInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = createNoteSchema.parse(input ?? {});

  logger.debug("Creating note", {
    userId,
    title: parsed.title,
  });

  const note = await prisma.note.create({
    data: {
      userId,
      title: parsed.title,
      content: parsed.content,
      projectId: parsed.projectId,
    },
  });

  logger.info("Note created successfully", {
    noteId: note.id,
    userId,
    durationMs: Date.now() - start,
  });

  return note;
}

/**
 * Save a chat message as a note (assistant messages only)
 */
export async function saveMessageAsNote(input: SaveMessageAsNoteInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = saveMessageAsNoteSchema.parse(input);

  logger.debug("Saving message as note", {
    userId,
    messageId: parsed.messageId,
  });

  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.findFirst({
      where: { id: parsed.messageId, thread: { userId } },
      include: { thread: { select: { projectId: true } } },
    });

    if (!message) {
      throw new Error("Message not found");
    }

    if (message.role !== "ASSISTANT") {
      throw new Error("Only assistant messages can be saved as notes");
    }

    const existingNote = await tx.note.findFirst({
      where: {
        userId,
        deletedAt: null,
        sourceMessageId: message.id,
      },
    });

    if (existingNote) {
      if (message.savedNoteId !== existingNote.id) {
        await tx.chatMessage.update({
          where: { id: message.id },
          data: { savedNoteId: existingNote.id },
        });
      }

      return { note: existingNote, alreadySaved: true };
    }

    const note = await tx.note.create({
      data: buildNoteFromMessage({
        userId,
        sourceMessageId: message.id,
        content: message.content,
        projectId: message.thread.projectId ?? null,
      }),
    });

    await tx.chatMessage.update({
      where: { id: message.id },
      data: { savedNoteId: note.id },
    });

    return { note, alreadySaved: false };
  });

  logger.info("Message saved as note", {
    userId,
    messageId: parsed.messageId,
    noteId: result.note.id,
    alreadySaved: result.alreadySaved,
    durationMs: Date.now() - start,
  });

  return result;
}

/**
 * Update a note (validates ownership)
 */
export async function updateNote(input: UpdateNoteInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = updateNoteSchema.parse(input);

  logger.debug("Updating note", {
    userId,
    noteId: parsed.id,
    hasTitle: !!parsed.title,
    hasContent: !!parsed.content,
  });

  // Verify ownership
  const existingNote = await prisma.note.findFirst({
    where: {
      id: parsed.id,
      userId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!existingNote) {
    logger.warn("Note not found for update", {
      userId,
      noteId: parsed.id,
    });
    throw new Error("Note not found");
  }

  const updateData: Prisma.NoteUpdateInput = {};
  if (parsed.title !== undefined) updateData.title = parsed.title;
  if (parsed.content !== undefined) updateData.content = parsed.content;

  const note = await prisma.note.update({
    where: { id: parsed.id },
    data: updateData,
  });

  logger.info("Note updated successfully", {
    noteId: note.id,
    userId,
    durationMs: Date.now() - start,
  });

  return note;
}

/**
 * Soft delete a note (validates ownership)
 */
export async function deleteNote(input: DeleteNoteInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = deleteNoteSchema.parse(input);

  logger.debug("Deleting note", {
    userId,
    noteId: parsed.id,
  });

  // Verify ownership
  const existingNote = await prisma.note.findFirst({
    where: {
      id: parsed.id,
      userId,
      deletedAt: null,
    },
    select: {
      id: true,
      sourceMessageId: true,
    },
  });

  if (!existingNote) {
    logger.warn("Note not found for delete", {
      userId,
      noteId: parsed.id,
    });
    throw new Error("Note not found");
  }

  const note = await prisma.$transaction(async (tx) => {
    const updated = await tx.note.update({
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

    return updated;
  });

  logger.info("Note deleted successfully", {
    noteId: note.id,
    userId,
    durationMs: Date.now() - start,
  });

  return { success: true };
}
