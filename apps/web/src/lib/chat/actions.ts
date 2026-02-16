"use server";

import { apiFetchJson } from "@/lib/api/fetch";
import type { ChatMessage, ChatThread, Project } from "@life-os/db";
import {
  listThreadsSchema,
  createThreadSchema,
  archiveThreadSchema,
  setThreadModelSchema,
  listMessagesSchema,
  type ListThreadsInput,
  type CreateThreadInput,
  type ArchiveThreadInput,
  type SetThreadModelInput,
  type ListMessagesInput,
} from "./validations";

type ProjectResponse = Omit<Project, "archivedAt" | "createdAt" | "updatedAt"> & {
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatThreadResponse = Omit<
  ChatThread,
  "summaryUpTo" | "lastChattedAt" | "archivedAt" | "createdAt" | "updatedAt"
> & {
  summaryUpTo: string | null;
  lastChattedAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: ProjectResponse | null;
};

type ChatMessageResponse = Omit<ChatMessage, "createdAt"> & {
  createdAt: string;
};

type ListMessagesResponse = {
  threadId: string;
  messages: ChatMessageResponse[];
  nextCursor: {
    id: string;
    createdAt: string;
  } | null;
};

type ModelOptionResponse = {
  key: string;
  label: string;
  provider: string;
  costTier: string | null;
  description: string | null;
  supportsStreaming: boolean;
};

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date received from API");
  }
  return parsed;
}

function hydrateProject(project: ProjectResponse): Project {
  return {
    ...project,
    archivedAt: project.archivedAt ? parseDate(project.archivedAt) : null,
    createdAt: parseDate(project.createdAt),
    updatedAt: parseDate(project.updatedAt),
  };
}

function hydrateThread(thread: ChatThreadResponse): ChatThread & { project: Project | null } {
  return {
    ...thread,
    summaryUpTo: thread.summaryUpTo ? parseDate(thread.summaryUpTo) : null,
    lastChattedAt: parseDate(thread.lastChattedAt),
    archivedAt: thread.archivedAt ? parseDate(thread.archivedAt) : null,
    createdAt: parseDate(thread.createdAt),
    updatedAt: parseDate(thread.updatedAt),
    project: thread.project ? hydrateProject(thread.project) : null,
  };
}

function hydrateMessage(message: ChatMessageResponse): ChatMessage {
  return {
    ...message,
    createdAt: parseDate(message.createdAt),
  };
}

export async function listThreads(input?: ListThreadsInput) {
  const parsed = listThreadsSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.includeArchived) {
    params.set("includeArchived", "true");
  }
  if (parsed.projectId) {
    params.set("projectId", parsed.projectId);
  }

  const path = params.size ? `/chat/threads?${params.toString()}` : "/chat/threads";
  const threads = await apiFetchJson<ChatThreadResponse[]>(path);

  return threads.map(hydrateThread);
}

export async function createThread(input?: CreateThreadInput) {
  const parsed = createThreadSchema.parse(input ?? {});
  const thread = await apiFetchJson<ChatThreadResponse>("/chat/threads", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsed),
  });

  return hydrateThread(thread);
}

export async function archiveThread(input: ArchiveThreadInput) {
  const parsed = archiveThreadSchema.parse(input);
  const thread = await apiFetchJson<ChatThreadResponse>(
    `/chat/threads/${parsed.threadId}/archive`,
    {
      method: "POST",
    },
  );

  return hydrateThread(thread);
}

export async function getThread(threadId: string) {
  const thread = await apiFetchJson<ChatThreadResponse>(`/chat/threads/${threadId}`);
  return hydrateThread(thread);
}

export async function setThreadModel(input: SetThreadModelInput) {
  const parsed = setThreadModelSchema.parse(input);
  const thread = await apiFetchJson<ChatThreadResponse>(
    `/chat/threads/${parsed.threadId}/model`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ modelKey: parsed.modelKey }),
    },
  );

  return hydrateThread(thread);
}

export async function listMessages(input: ListMessagesInput) {
  const parsed = listMessagesSchema.parse(input);
  const params = new URLSearchParams();

  if (parsed.limit !== undefined) {
    params.set("limit", String(parsed.limit));
  }
  if (parsed.cursor) {
    params.set("cursorId", parsed.cursor.id);
    params.set("cursorCreatedAt", parsed.cursor.createdAt.toISOString());
  }

  const path = params.size
    ? `/chat/threads/${parsed.threadId}/messages?${params.toString()}`
    : `/chat/threads/${parsed.threadId}/messages`;
  const page = await apiFetchJson<ListMessagesResponse>(path);

  return {
    threadId: page.threadId,
    messages: page.messages.map(hydrateMessage),
    nextCursor: page.nextCursor
      ? {
          id: page.nextCursor.id,
          createdAt: parseDate(page.nextCursor.createdAt),
        }
      : null,
  };
}

export async function listModels() {
  return apiFetchJson<ModelOptionResponse[]>("/chat/models");
}

export type ModelOption = Awaited<ReturnType<typeof listModels>>[number];
