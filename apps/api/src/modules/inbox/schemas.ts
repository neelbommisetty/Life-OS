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

export const archiveInboxItemSchema = z.object({
  id: z.string().cuid(),
});

export const unarchiveInboxItemSchema = z.object({
  id: z.string().cuid(),
});

export type InboxItemState = z.infer<typeof inboxItemStateEnum>;
export type ListInboxItemsInput = z.infer<typeof listInboxItemsSchema>;
export type ListArchivedInboxItemsInput = z.infer<typeof listArchivedInboxItemsSchema>;
export type GetInboxItemByIdInput = z.infer<typeof getInboxItemByIdSchema>;
export type CreateInboxItemInput = z.infer<typeof createInboxItemSchema>;
export type ProcessInboxItemInput = z.infer<typeof processInboxItemSchema>;
export type ArchiveInboxItemInput = z.infer<typeof archiveInboxItemSchema>;
export type UnarchiveInboxItemInput = z.infer<typeof unarchiveInboxItemSchema>;
