import { z } from "zod";

export const getThreadSchema = z.object({
  projectId: z.string().cuid(),
  threadId: z.string().cuid().optional(),
});

export const sendMessageSchema = z.object({
  projectId: z.string().cuid(),
  threadId: z.string().cuid().optional(),
  content: z
    .string()
    .min(1, "Message cannot be empty")
    .max(10000)
    .refine((val) => val.trim().length > 0, {
      message: "Message cannot be only whitespace",
    }),
});

export const setThreadModelSchema = z.object({
  projectId: z.string().cuid(),
  threadId: z.string().cuid().optional(),
  modelKey: z.string().min(1, "Model key is required").nullable(),
});

export const listMessagesSchema = z.object({
  projectId: z.string().cuid(),
  threadId: z.string().cuid(),
  cursor: z
    .object({
      id: z.string().cuid(),
      createdAt: z.date(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// Schema for streaming chat request
export const streamMessageSchema = z.object({
  projectId: z.string().cuid(),
  threadId: z.string().cuid().optional(),
  content: z
    .string()
    .min(1, "Message cannot be empty")
    .max(10000)
    .refine((val) => val.trim().length > 0, {
      message: "Message cannot be only whitespace",
    }),
});

export const listThreadsSchema = z.object({
  projectId: z.string().cuid(),
  includeArchived: z.boolean().optional(),
});

export const createThreadSchema = z.object({
  projectId: z.string().cuid(),
  name: z.string().min(1).max(120).optional(),
});

export const archiveThreadSchema = z.object({
  projectId: z.string().cuid(),
  threadId: z.string().cuid(),
});

// Stream event schema for validation
export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chunk"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("done"),
  }),
  z.object({
    type: z.literal("error"),
    error: z.string(),
  }),
  z.object({
    type: z.literal("message_saved"),
    messageId: z.string(),
  }),
]);

export type GetThreadInput = z.infer<typeof getThreadSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SetThreadModelInput = z.infer<typeof setThreadModelSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
export type StreamMessageInput = z.infer<typeof streamMessageSchema>;
export type ListThreadsInput = z.infer<typeof listThreadsSchema>;
export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type ArchiveThreadInput = z.infer<typeof archiveThreadSchema>;
export type StreamEvent = z.infer<typeof streamEventSchema>;
