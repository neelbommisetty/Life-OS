import { z } from "zod";

export const getThreadSchema = z.object({
  projectId: z.string().cuid(),
});

export const sendMessageSchema = z.object({
  projectId: z.string().cuid(),
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
  modelKey: z.string().min(1, "Model key is required").nullable(),
});

export const listMessagesSchema = z.object({
  projectId: z.string().cuid(),
  cursor: z
    .object({
      id: z.string().cuid(),
      createdAt: z.date(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type GetThreadInput = z.infer<typeof getThreadSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SetThreadModelInput = z.infer<typeof setThreadModelSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
