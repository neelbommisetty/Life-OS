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
  type ListArchivedInboxItemsInput,
  type ListInboxItemsInput,
  type ProcessInboxItemInput,
  type UnarchiveInboxItemInput,
} from "./schemas.js";

const ACTIVE_ITEM_ORDER = [{ createdAt: "desc" }] as const;
const ARCHIVED_ITEM_ORDER = [{ archivedAt: "desc" }, { createdAt: "desc" }] as const;
const AUTO_ARCHIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type InboxItemRecord = {
  id: string;
  state: "SAVED" | "PROCESSING" | "REVIEW" | "PROCESSED" | "ARCHIVED";
  processedAt: Date | null;
  archivedAt: Date | null;
};

export type InboxDb = {
  inboxItem: {
    updateMany: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

async function autoArchiveProcessedItems(params: {
  db: InboxDb;
  userId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const archiveThreshold = new Date(now.getTime() - AUTO_ARCHIVE_WINDOW_MS);

  await params.db.inboxItem.updateMany({
    where: {
      userId: params.userId,
      state: "PROCESSED",
      archivedAt: null,
      processedAt: {
        lte: archiveThreshold,
      },
    },
    data: {
      state: "ARCHIVED",
      archivedAt: now,
    },
  });
}

async function getInboxItemOrThrow(params: {
  db: InboxDb;
  userId: string;
  id: string;
}) {
  const item = (await params.db.inboxItem.findFirst({
    where: {
      id: params.id,
      userId: params.userId,
    },
  })) as InboxItemRecord | null;

  if (!item) {
    throw new Error("Inbox item not found");
  }

  return item;
}

export async function listInboxItems(params: {
  db: InboxDb;
  userId: string;
  input?: ListInboxItemsInput;
  now?: Date;
}) {
  const parsed = listInboxItemsSchema.parse(params.input ?? {});

  await autoArchiveProcessedItems({
    db: params.db,
    userId: params.userId,
    now: params.now,
  });

  const where = {
    userId: params.userId,
    state: {
      not: "ARCHIVED",
    },
    ...(parsed.state ? { state: parsed.state } : {}),
    ...(parsed.search
      ? {
          content: {
            contains: parsed.search,
            mode: "insensitive",
          },
        }
      : {}),
  };

  return params.db.inboxItem.findMany({
    where,
    orderBy: ACTIVE_ITEM_ORDER,
  });
}

export async function listArchivedInboxItems(params: {
  db: InboxDb;
  userId: string;
  input?: ListArchivedInboxItemsInput;
  now?: Date;
}) {
  const parsed = listArchivedInboxItemsSchema.parse(params.input ?? {});

  await autoArchiveProcessedItems({
    db: params.db,
    userId: params.userId,
    now: params.now,
  });

  return params.db.inboxItem.findMany({
    where: {
      userId: params.userId,
      state: "ARCHIVED",
      ...(parsed.search
        ? {
            content: {
              contains: parsed.search,
              mode: "insensitive",
            },
          }
        : {}),
    },
    orderBy: ARCHIVED_ITEM_ORDER,
  });
}

export async function getInboxItemById(params: {
  db: InboxDb;
  userId: string;
  input: GetInboxItemByIdInput;
}) {
  const parsed = getInboxItemByIdSchema.parse(params.input);

  await autoArchiveProcessedItems({
    db: params.db,
    userId: params.userId,
  });

  return getInboxItemOrThrow({
    db: params.db,
    userId: params.userId,
    id: parsed.id,
  });
}

export async function createInboxItem(params: {
  db: InboxDb;
  userId: string;
  input?: CreateInboxItemInput;
}) {
  const parsed = createInboxItemSchema.parse(params.input ?? {});

  return params.db.inboxItem.create({
    data: {
      userId: params.userId,
      content: parsed.content,
      state: "SAVED",
    },
  });
}

export async function processInboxItem(params: {
  db: InboxDb;
  userId: string;
  input: ProcessInboxItemInput;
  now?: Date;
}) {
  const parsed = processInboxItemSchema.parse(params.input);
  const now = params.now ?? new Date();

  const item = await getInboxItemOrThrow({
    db: params.db,
    userId: params.userId,
    id: parsed.id,
  });

  if (item.state === "ARCHIVED") {
    throw new Error("Archived inbox items cannot be processed");
  }

  if (item.state === "PROCESSED") {
    return item;
  }

  return params.db.inboxItem.update({
    where: {
      id: parsed.id,
    },
    data: {
      state: "PROCESSED",
      processedAt: now,
    },
  });
}

export async function archiveInboxItem(params: {
  db: InboxDb;
  userId: string;
  input: ArchiveInboxItemInput;
  now?: Date;
}) {
  const parsed = archiveInboxItemSchema.parse(params.input);
  const now = params.now ?? new Date();

  const item = await getInboxItemOrThrow({
    db: params.db,
    userId: params.userId,
    id: parsed.id,
  });

  if (item.state === "ARCHIVED") {
    return item;
  }

  return params.db.inboxItem.update({
    where: {
      id: parsed.id,
    },
    data: {
      state: "ARCHIVED",
      archivedAt: now,
    },
  });
}

export async function unarchiveInboxItem(params: {
  db: InboxDb;
  userId: string;
  input: UnarchiveInboxItemInput;
}) {
  const parsed = unarchiveInboxItemSchema.parse(params.input);

  const item = await getInboxItemOrThrow({
    db: params.db,
    userId: params.userId,
    id: parsed.id,
  });

  if (item.state !== "ARCHIVED") {
    return item;
  }

  return params.db.inboxItem.update({
    where: {
      id: parsed.id,
    },
    data: {
      state: item.processedAt ? "PROCESSED" : "SAVED",
      archivedAt: null,
    },
  });
}
