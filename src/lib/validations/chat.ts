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

export type GetThreadInput = z.infer<typeof getThreadSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

