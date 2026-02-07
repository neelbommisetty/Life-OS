import {
  archiveThreadSchema,
  createThreadSchema,
  getThreadSchema,
  listMessagesSchema,
  listThreadsSchema,
  setThreadModelSchema,
  type ArchiveThreadInput,
  type CreateThreadInput,
  type ListMessagesInput,
  type ListThreadsInput,
  type SetThreadModelInput,
} from "./schemas.js";
import type { ModelKey, ModelMetadata } from "@life-os/ai";

const DEFAULT_THREAD_NAME = "New thread";
const THREAD_ORDER = [{ lastChattedAt: "desc" }, { createdAt: "desc" }] as const;

export type ChatModelRegistry = {
  has: (key: ModelKey) => boolean;
  getMetadata: (key: ModelKey) => ModelMetadata | undefined;
  listMetadata: () => ModelMetadata[];
};

export type ChatDb = {
  chatThread: {
    findMany: (args: unknown) => Promise<unknown[]>;
    create: (args: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  chatMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
};

async function getUniqueThreadName(params: {
  db: ChatDb;
  userId: string;
  baseName: string;
}) {
  const existingThreads = (await params.db.chatThread.findMany({
    where: {
      userId: params.userId,
    },
    select: {
      name: true,
    },
  })) as { name: string }[];

  const existingNames = new Set(existingThreads.map((thread) => thread.name));

  if (!existingNames.has(params.baseName)) {
    return params.baseName;
  }

  let suffix = 1;
  while (existingNames.has(`${params.baseName} (${suffix})`)) {
    suffix += 1;
  }

  return `${params.baseName} (${suffix})`;
}

export async function listThreads(params: {
  db: ChatDb;
  userId: string;
  input?: ListThreadsInput;
}) {
  const parsed = listThreadsSchema.parse(params.input ?? {});
  const includeArchived = parsed.includeArchived ?? false;

  let threads = await params.db.chatThread.findMany({
    where: {
      userId: params.userId,
      ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: THREAD_ORDER,
    include: {
      project: true,
    },
  });

  if (!includeArchived && threads.length === 0) {
    const name = await getUniqueThreadName({
      db: params.db,
      userId: params.userId,
      baseName: DEFAULT_THREAD_NAME,
    });

    const created = await params.db.chatThread.create({
      data: {
        userId: params.userId,
        name,
        lastChattedAt: new Date(),
      },
      include: {
        project: true,
      },
    });

    threads = [created];
  }

  return threads;
}

export async function createThread(params: {
  db: ChatDb;
  userId: string;
  input?: CreateThreadInput;
}) {
  const parsed = createThreadSchema.parse(params.input ?? {});

  const baseName = parsed.name?.trim() || DEFAULT_THREAD_NAME;
  const name = await getUniqueThreadName({
    db: params.db,
    userId: params.userId,
    baseName,
  });

  return params.db.chatThread.create({
    data: {
      userId: params.userId,
      name,
      lastChattedAt: new Date(),
      projectId: parsed.projectId,
    },
    include: {
      project: true,
    },
  });
}

export async function archiveThread(params: {
  db: ChatDb;
  userId: string;
  input: ArchiveThreadInput;
}) {
  const parsed = archiveThreadSchema.parse(params.input);

  const thread = await params.db.chatThread.findFirst({
    where: {
      id: parsed.threadId,
      userId: params.userId,
    },
  });

  if (!thread) {
    throw new Error("Thread not found");
  }

  return params.db.chatThread.update({
    where: {
      id: parsed.threadId,
    },
    data: {
      archivedAt: new Date(),
    },
    include: {
      project: true,
    },
  });
}

export async function getThread(params: {
  db: ChatDb;
  userId: string;
  threadId: string;
  modelRegistry: ChatModelRegistry;
}) {
  const parsed = getThreadSchema.parse({ threadId: params.threadId });

  let thread = (await params.db.chatThread.findFirst({
    where: {
      id: parsed.threadId,
      userId: params.userId,
    },
    include: {
      project: true,
    },
  })) as { id: string; modelKey: string | null } | null;

  if (!thread) {
    throw new Error("Thread not found");
  }

  const hasInvalidModel =
    thread.modelKey && !params.modelRegistry.has(thread.modelKey as ModelKey);

  if (hasInvalidModel) {
    thread = (await params.db.chatThread.update({
      where: { id: thread.id },
      data: { modelKey: null },
      include: { project: true },
    })) as { id: string; modelKey: string | null };
  }

  return thread;
}

export async function setThreadModel(params: {
  db: ChatDb;
  userId: string;
  input: SetThreadModelInput;
  modelRegistry: ChatModelRegistry;
}) {
  const parsed = setThreadModelSchema.parse(params.input);

  if (parsed.modelKey) {
    const modelMetadata = params.modelRegistry.getMetadata(
      parsed.modelKey as ModelKey,
    );
    if (!modelMetadata || !modelMetadata.modes.includes("text")) {
      throw new Error("Selected model is not available");
    }
  }

  const thread = await params.db.chatThread.findFirst({
    where: {
      id: parsed.threadId,
      userId: params.userId,
    },
  });

  if (!thread) {
    throw new Error("Thread not found");
  }

  return params.db.chatThread.update({
    where: {
      id: parsed.threadId,
    },
    data: {
      modelKey: parsed.modelKey,
    },
    include: {
      project: true,
    },
  });
}

export async function listMessages(params: {
  db: ChatDb;
  userId: string;
  input: ListMessagesInput;
}) {
  const parsed = listMessagesSchema.parse(params.input);

  const thread = (await params.db.chatThread.findFirst({
    where: {
      id: parsed.threadId,
      userId: params.userId,
    },
  })) as { id: string } | null;

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
      {
        createdAt: parsed.cursor.createdAt,
        id: {
          lt: parsed.cursor.id,
        },
      },
    ];
  }

  const messages = (await params.db.chatMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  })) as { id: string; createdAt: Date }[];

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;
  const lastItem = page[page.length - 1] ?? null;

  return {
    threadId: thread.id,
    messages: page.reverse(),
    nextCursor: hasMore && lastItem
      ? {
          id: lastItem.id,
          createdAt: lastItem.createdAt,
        }
      : null,
  };
}

export function listModels(modelRegistry: ChatModelRegistry) {
  return modelRegistry
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
}
