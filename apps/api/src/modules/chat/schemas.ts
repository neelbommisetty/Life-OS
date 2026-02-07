import { z } from "zod";

export const listThreadsSchema = z.object({
  includeArchived: z.boolean().optional(),
  projectId: z.string().cuid().optional(),
});

export const createThreadSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  projectId: z.string().cuid().optional(),
});

export const archiveThreadSchema = z.object({
  threadId: z.string().cuid(),
});

export const getThreadSchema = z.object({
  threadId: z.string().cuid(),
});

export const setThreadModelSchema = z.object({
  threadId: z.string().cuid(),
  modelKey: z.string().min(1, "Model key is required").nullable(),
});

export const listMessagesSchema = z.object({
  threadId: z.string().cuid(),
  cursor: z
    .object({
      id: z.string().cuid(),
      createdAt: z.date(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const streamMessageSchema = z
  .object({
    threadId: z.string().cuid().optional(),
    content: z
      .string()
      .min(1, "Message cannot be empty")
      .max(10000)
      .refine((value) => value.trim().length > 0, {
        message: "Message cannot be only whitespace",
      })
      .optional(),
    regenerateFromMessageId: z.string().cuid().optional(),
  })
  .refine((data) => data.content || data.regenerateFromMessageId, {
    message: "Content or regenerateFromMessageId is required",
  });

export type ListThreadsInput = z.infer<typeof listThreadsSchema>;
export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type ArchiveThreadInput = z.infer<typeof archiveThreadSchema>;
export type GetThreadInput = z.infer<typeof getThreadSchema>;
export type SetThreadModelInput = z.infer<typeof setThreadModelSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
export type StreamMessageInput = z.infer<typeof streamMessageSchema>;
