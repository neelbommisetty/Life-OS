import { z } from "zod";

export const listNotesSchema = z.object({
  search: z.string().optional(),
});

export const createNoteSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  content: z.string().max(100000), // Large limit for markdown content
});

export const updateNoteSchema = createNoteSchema.partial().extend({
  id: z.string().cuid(),
});

export const deleteNoteSchema = z.object({
  id: z.string().cuid(),
});

export const getNoteByIdSchema = z.object({
  id: z.string().cuid(),
});

export type ListNotesInput = z.infer<typeof listNotesSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type DeleteNoteInput = z.infer<typeof deleteNoteSchema>;
export type GetNoteByIdInput = z.infer<typeof getNoteByIdSchema>;
