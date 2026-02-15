"use server";

import { apiFetchJson } from "@/lib/api/fetch";
import {
  archiveInboxItemSchema,
  createInboxItemSchema,
  getInboxItemByIdSchema,
  listArchivedInboxItemsSchema,
  listInboxItemsSchema,
  processInboxItemSchema,
  unarchiveInboxItemSchema,
  type ArchiveInboxItemInput,
  type CreateInboxItemInput,
  type GetInboxItemByIdInput,
  type InboxItemState,
  type ListArchivedInboxItemsInput,
  type ListInboxItemsInput,
  type ProcessInboxItemInput,
  type UnarchiveInboxItemInput,
} from "./validations";

type InboxItemResponse = {
  id: string;
  userId: string;
  content: string;
  state: InboxItemState;
  processedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InboxItem = {
  id: string;
  userId: string;
  content: string;
  state: InboxItemState;
  processedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date received from API");
  }

  return parsed;
}

function hydrateInboxItem(item: InboxItemResponse): InboxItem {
  return {
    ...item,
    processedAt: item.processedAt ? parseDate(item.processedAt) : null,
    archivedAt: item.archivedAt ? parseDate(item.archivedAt) : null,
    createdAt: parseDate(item.createdAt),
    updatedAt: parseDate(item.updatedAt),
  };
}

export async function listInboxItems(input?: ListInboxItemsInput) {
  const parsed = listInboxItemsSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.search) {
    params.set("search", parsed.search);
  }

  if (parsed.state) {
    params.set("state", parsed.state);
  }

  const path = params.size ? `/api/inbox?${params.toString()}` : "/api/inbox";
  const items = await apiFetchJson<InboxItemResponse[]>(path);

  return items.map(hydrateInboxItem);
}

export async function listArchivedInboxItems(input?: ListArchivedInboxItemsInput) {
  const parsed = listArchivedInboxItemsSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.search) {
    params.set("search", parsed.search);
  }

  const path = params.size
    ? `/api/inbox/archived?${params.toString()}`
    : "/api/inbox/archived";
  const items = await apiFetchJson<InboxItemResponse[]>(path);

  return items.map(hydrateInboxItem);
}

export async function getInboxItemById(input: GetInboxItemByIdInput) {
  const parsed = getInboxItemByIdSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/api/inbox/${parsed.id}`);

  return hydrateInboxItem(item);
}

export async function createInboxItem(input: CreateInboxItemInput) {
  const parsed = createInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>("/api/inbox", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsed),
  });

  return hydrateInboxItem(item);
}

export async function processInboxItem(input: ProcessInboxItemInput) {
  const parsed = processInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/api/inbox/${parsed.id}/process`, {
    method: "POST",
  });

  return hydrateInboxItem(item);
}

export async function archiveInboxItem(input: ArchiveInboxItemInput) {
  const parsed = archiveInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/api/inbox/${parsed.id}/archive`, {
    method: "POST",
  });

  return hydrateInboxItem(item);
}

export async function unarchiveInboxItem(input: UnarchiveInboxItemInput) {
  const parsed = unarchiveInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/api/inbox/${parsed.id}/unarchive`, {
    method: "POST",
  });

  return hydrateInboxItem(item);
}
