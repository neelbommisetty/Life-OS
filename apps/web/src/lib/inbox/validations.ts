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
});

export const skipInboxOutputSchema = resolveInboxOutputSchema.extend({
  reason: z.string().max(500).optional(),
});

export const bulkResolveInboxOutputsSchema = z.object({
  itemId: z.string().cuid(),
});

export const inboxCreatedArtifactSchema = z.object({
  type: z.enum(["note", "task"]),
  id: z.string().cuid(),
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
export type InboxCreatedArtifact = z.infer<typeof inboxCreatedArtifactSchema>;
