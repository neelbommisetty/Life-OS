import { z } from "zod";

export const inboxItemStateEnum = z.enum([
  "SAVED",
  "PROCESSING",
  "REVIEW",
  "PROCESSED",
  "ARCHIVED",
]);

const activeInboxItemStateEnum = z.enum([
  "SAVED",
  "PROCESSING",
  "REVIEW",
  "PROCESSED",
]);

export const inboxProposalOutputStateEnum = z.enum([
  "PENDING",
  "APPROVED",
  "DECLINED",
  "FAILED",
  "SKIPPED",
]);

export const inboxAgentKeyEnum = z.enum(["kb_note", "todo_list"]);

export const listInboxItemsSchema = z.object({
  search: z.string().optional(),
  state: activeInboxItemStateEnum.optional(),
});

export const listArchivedInboxItemsSchema = z.object({
  search: z.string().optional(),
});

export const getInboxItemByIdSchema = z.object({
  id: z.string().cuid(),
});

export const createInboxItemSchema = z.object({
  content: z.string().min(1, "Content is required").max(10000),
});

export const processInboxItemSchema = z.object({
  id: z.string().cuid(),
});

export const recoverInboxItemSchema = z.object({
  id: z.string().cuid(),
});

export const archiveInboxItemSchema = z.object({
  id: z.string().cuid(),
});

export const unarchiveInboxItemSchema = z.object({
  id: z.string().cuid(),
});

export const getInboxOutputsSchema = z.object({
  itemId: z.string().cuid(),
});

export const resolveInboxOutputSchema = z.object({
  outputId: z.string().cuid(),
  idempotencyKey: z.string().min(1, "Idempotency-Key header is required"),
});

export const skipInboxOutputSchema = resolveInboxOutputSchema.extend({
  reason: z.string().max(500).optional(),
});

export const bulkResolveInboxOutputsSchema = z.object({
  itemId: z.string().cuid(),
  idempotencyKey: z.string().min(1, "Idempotency-Key header is required"),
});

export const inboxAgentConfigPatchSchema = z.object({
  agents: z
    .array(
      z.object({
        key: inboxAgentKeyEnum,
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
});

export const kbNotePayloadSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(100000),
});

export const todoTaskPayloadSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  dueDate: z
    .union([z.string(), z.null()])
    .optional()
    .refine(
      (value) => {
        if (value === undefined || value === null || value === "") {
          return true;
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return true;
        }

        const parsed = new Date(value);
        return !Number.isNaN(parsed.getTime());
      },
      { message: "Invalid date format" },
    ),
});

export const todoListPayloadSchema = z.object({
  tasks: z.array(todoTaskPayloadSchema).min(1).max(100),
});

export type InboxItemState = z.infer<typeof inboxItemStateEnum>;
export type InboxProposalOutputState = z.infer<typeof inboxProposalOutputStateEnum>;
export type InboxAgentKey = z.infer<typeof inboxAgentKeyEnum>;
export type ListInboxItemsInput = z.infer<typeof listInboxItemsSchema>;
export type ListArchivedInboxItemsInput = z.infer<typeof listArchivedInboxItemsSchema>;
export type GetInboxItemByIdInput = z.infer<typeof getInboxItemByIdSchema>;
export type CreateInboxItemInput = z.infer<typeof createInboxItemSchema>;
export type ProcessInboxItemInput = z.infer<typeof processInboxItemSchema>;
export type RecoverInboxItemInput = z.infer<typeof recoverInboxItemSchema>;
export type ArchiveInboxItemInput = z.infer<typeof archiveInboxItemSchema>;
export type UnarchiveInboxItemInput = z.infer<typeof unarchiveInboxItemSchema>;
export type GetInboxOutputsInput = z.infer<typeof getInboxOutputsSchema>;
export type ResolveInboxOutputInput = z.infer<typeof resolveInboxOutputSchema>;
export type SkipInboxOutputInput = z.infer<typeof skipInboxOutputSchema>;
export type BulkResolveInboxOutputsInput = z.infer<typeof bulkResolveInboxOutputsSchema>;
export type InboxAgentConfigPatchInput = z.infer<typeof inboxAgentConfigPatchSchema>;
export type KbNotePayload = z.infer<typeof kbNotePayloadSchema>;
export type TodoTaskPayload = z.infer<typeof todoTaskPayloadSchema>;
export type TodoListPayload = z.infer<typeof todoListPayloadSchema>;
