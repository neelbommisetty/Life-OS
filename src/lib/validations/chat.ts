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

export type GetThreadInput = z.infer<typeof getThreadSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SetThreadModelInput = z.infer<typeof setThreadModelSchema>;
