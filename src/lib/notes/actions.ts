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
  type ListNotesInput,
  type CreateNoteInput,
  type UpdateNoteInput,
  type DeleteNoteInput,
  type GetNoteByIdInput,
} from "./validations";

const logger = createLogger("notes:actions");

const NOTE_ORDER: Prisma.NoteOrderByWithRelationInput[] = [
  { updatedAt: "desc" },
];

/**
 * Get the current authenticated user ID
 */
async function getCurrentUserId(): Promise<string> {
  const { data: session } = await authServer.getSession();

  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please sign in to continue");
  }

  return session.user.id;
}

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
  });

  if (!existingNote) {
    logger.warn("Note not found for delete", {
      userId,
      noteId: parsed.id,
    });
    throw new Error("Note not found");
  }

  // Soft delete by setting deletedAt
  const note = await prisma.note.update({
    where: { id: parsed.id },
    data: {
      deletedAt: new Date(),
    },
  });

  logger.info("Note deleted successfully", {
    noteId: note.id,
    userId,
    durationMs: Date.now() - start,
  });

  return { success: true };
}
