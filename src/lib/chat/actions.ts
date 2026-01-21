"use server";

import { prisma } from "@/lib/db";
import { authServer } from "@/lib/auth/server";
import { createLogger } from "@/lib/logger";
import { modelRegistry } from "@/lib/ai";
import type { ModelKey } from "@/lib/ai/providers/types";
// Initialize AI providers and chat services
import "@/lib/ai/init";
import type { Prisma } from "@prisma/client";
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

const logger = createLogger("chat:actions");

const DEFAULT_THREAD_NAME = "New thread";
const THREAD_ORDER: Prisma.ChatThreadOrderByWithRelationInput[] = [
  { lastChattedAt: "desc" },
  { createdAt: "desc" },
];

/**
 * Get a unique thread name for the user (handles duplicates like "New thread (1)")
 */
async function getUniqueThreadName(
  userId: string,
  baseName: string
): Promise<string> {
  const existingThreads = await prisma.chatThread.findMany({
    where: { userId },
    select: { name: true },
  });

  const existingNames = new Set(existingThreads.map((t) => t.name));

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let suffix = 1;
  while (existingNames.has(`${baseName} (${suffix})`)) {
    suffix += 1;
  }

  return `${baseName} (${suffix})`;
}

/**
 * Get the current authenticated user ID
 */
async function getCurrentUserId(): Promise<string> {
  const { data: session } = await authServer.getSession();

  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please sign in to continue");
  }

  return session.user.id;
}

/**
 * List threads for the current user
 */
export async function listThreads(input?: ListThreadsInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = listThreadsSchema.parse(input ?? {});

  logger.debug("Listing chat threads", { userId });

  const includeArchived = parsed.includeArchived ?? false;

  let threads = await prisma.chatThread.findMany({
    where: {
      userId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: THREAD_ORDER,
    include: {
      project: true,
    },
  });

  // Auto-create a default thread if none exist
  if (!includeArchived && threads.length === 0) {
    const name = await getUniqueThreadName(userId, DEFAULT_THREAD_NAME);
    const created = await prisma.chatThread.create({
      data: {
        userId,
        name,
        lastChattedAt: new Date(),
      },
      include: {
        project: true,
      },
    });
    threads = [created];
  }

  logger.info("Chat threads listed", {
    userId,
    count: threads.length,
    durationMs: Date.now() - start,
  });

  return threads;
}

/**
 * Create a new thread for the current user
 */
export async function createThread(input?: CreateThreadInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = createThreadSchema.parse(input ?? {});

  logger.debug("Creating chat thread", { userId });

  const baseName = parsed.name?.trim() || DEFAULT_THREAD_NAME;
  const name = await getUniqueThreadName(userId, baseName);

  const thread = await prisma.chatThread.create({
    data: {
      userId,
      name,
      lastChattedAt: new Date(),
      projectId: parsed.projectId,
    },
    include: {
      project: true,
    },
  });

  logger.info("Chat thread created", {
    threadId: thread.id,
    durationMs: Date.now() - start,
  });

  return thread;
}

/**
 * Archive a thread
 */
export async function archiveThread(input: ArchiveThreadInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = archiveThreadSchema.parse(input);

  logger.debug("Archiving chat thread", {
    userId,
    threadId: parsed.threadId,
  });

  const thread = await prisma.chatThread.findFirst({
    where: {
      id: parsed.threadId,
      userId,
    },
  });

  if (!thread) {
    throw new Error("Thread not found");
  }

  const archivedThread = await prisma.chatThread.update({
    where: { id: parsed.threadId },
    data: {
      archivedAt: new Date(),
    },
    include: {
      project: true,
    },
  });

  logger.info("Chat thread archived", {
    threadId: archivedThread.id,
    durationMs: Date.now() - start,
  });

  return archivedThread;
}

/**
 * Get a thread by ID (validates ownership)
 */
export async function getThread(threadId: string) {
  const userId = await getCurrentUserId();

  const thread = await prisma.chatThread.findFirst({
    where: {
      id: threadId,
      userId,
    },
  });

  if (!thread) {
    throw new Error("Thread not found");
  }

  return thread;
}

/**
 * Set the model for a thread
 */
export async function setThreadModel(input: SetThreadModelInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = setThreadModelSchema.parse(input);

  logger.debug("Setting chat thread model", {
    userId,
    threadId: parsed.threadId,
    modelKey: parsed.modelKey,
  });

  // Validate model key if provided
  if (parsed.modelKey) {
    const modelMetadata = modelRegistry.getMetadata(parsed.modelKey as ModelKey);

    if (!modelMetadata || !modelMetadata.modes.includes("text")) {
      logger.warn("Invalid chat model selection", {
        userId,
        modelKey: parsed.modelKey,
      });
      throw new Error("Selected model is not available");
    }
  }

  // Verify thread ownership
  const thread = await prisma.chatThread.findFirst({
    where: {
      id: parsed.threadId,
      userId,
    },
  });

  if (!thread) {
    throw new Error("Thread not found");
  }

  const updatedThread = await prisma.chatThread.update({
    where: { id: thread.id },
    data: {
      modelKey: parsed.modelKey,
    },
    include: {
      project: true,
    },
  });

  logger.info("Chat thread model updated", {
    threadId: updatedThread.id,
    modelKey: updatedThread.modelKey,
    durationMs: Date.now() - start,
  });

  return updatedThread;
}

/**
 * List messages for a thread with pagination
 */
export async function listMessages(input: ListMessagesInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = listMessagesSchema.parse(input);

  logger.debug("Listing chat messages", {
    userId,
    threadId: parsed.threadId,
    hasCursor: !!parsed.cursor,
  });

  // Verify thread ownership
  const thread = await prisma.chatThread.findFirst({
    where: {
      id: parsed.threadId,
      userId,
    },
  });

  if (!thread) {
    throw new Error("Thread not found");
  }

  const limit = parsed.limit ?? 30;
  const take = limit + 1;
  const where: {
    threadId: string;
    OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
  } = { threadId: thread.id };

  if (parsed.cursor) {
    where.OR = [
      { createdAt: { lt: parsed.cursor.createdAt } },
      { createdAt: parsed.cursor.createdAt, id: { lt: parsed.cursor.id } },
    ];
  }

  const messages = await prisma.chatMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;
  const nextCursor = hasMore
    ? {
        id: page[page.length - 1].id,
        createdAt: page[page.length - 1].createdAt,
      }
    : null;

  logger.info("Chat messages listed", {
    threadId: thread.id,
    messageCount: page.length,
    durationMs: Date.now() - start,
  });

  return {
    threadId: thread.id,
    messages: page.reverse(),
    nextCursor,
  };
}

/**
 * List available AI models for chat
 */
export async function listModels() {
  const models = modelRegistry
    .listMetadata()
    .filter((model) => model.modes.includes("text"))
    .map((model) => ({
      key: model.key,
      label: model.label,
      provider: model.providerId,
      costTier: model.costTier ?? null,
      description: model.description ?? null,
      supportsStreaming: model.supportsStreaming ?? false,
    }));

  return models;
}

export type ModelOption = Awaited<ReturnType<typeof listModels>>[number];
