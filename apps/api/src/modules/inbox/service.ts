import { callJson, getModelFor } from "@life-os/ai";
import { createLogger } from "@life-os/logger";
import {
  archiveInboxItemSchema,
  bulkResolveInboxOutputsSchema,
  createInboxItemSchema,
  getInboxItemByIdSchema,
  getInboxOutputsSchema,
  inboxAgentConfigPatchSchema,
  kbNotePayloadSchema,
  listArchivedInboxItemsSchema,
  listInboxItemsSchema,
  processInboxItemSchema,
  recoverInboxItemSchema,
  resolveInboxOutputSchema,
  skipInboxOutputSchema,
  todoListPayloadSchema,
  type ArchiveInboxItemInput,
  type BulkResolveInboxOutputsInput,
  type CreateInboxItemInput,
  type GetInboxItemByIdInput,
  type GetInboxOutputsInput,
  type InboxAgentConfigPatchInput,
  type ListArchivedInboxItemsInput,
  type ListInboxItemsInput,
  type ProcessInboxItemInput,
  type RecoverInboxItemInput,
  type ResolveInboxOutputInput,
  type SkipInboxOutputInput,
  type UnarchiveInboxItemInput,
  unarchiveInboxItemSchema,
} from "./schemas.js";
import { z } from "zod";

const logger = createLogger("api:inbox");

const ACTIVE_ITEM_ORDER = [{ createdAt: "desc" }] as const;
const ARCHIVED_ITEM_ORDER = [{ archivedAt: "desc" }, { createdAt: "desc" }] as const;
const OUTPUT_ORDER = [{ agentKey: "asc" }, { outputIndex: "asc" }, { createdAt: "asc" }] as const;

const AUTO_ARCHIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESSING_RECOVERY_WINDOW_MS = 2 * 60 * 1000;
const AGENT_TIMEOUT_MS = 30 * 1000;
const PROPOSAL_PAYLOAD_VERSION = 1;

type InboxItemRecord = {
  id: string;
  userId: string;
  content: string;
  state: "SAVED" | "PROCESSING" | "REVIEW" | "PROCESSED" | "ARCHIVED";
  processedAt: Date | null;
  archivedAt: Date | null;
  processingStartedAt: Date | null;
  processingError: string | null;
  agentConfigSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type DbAgentKey = "KB_NOTE" | "TODO_LIST";
type ClientAgentKey = "kb_note" | "todo_list";

type ProposalOutputState = "PENDING" | "APPROVED" | "DECLINED" | "FAILED" | "SKIPPED";

type ProposalOutputRecord = {
  id: string;
  userId: string;
  inboxItemId: string;
  agentKey: DbAgentKey;
  outputIndex: number;
  payloadVersion: number;
  payload: unknown;
  payloadPreview: string;
  state: ProposalOutputState;
  errorMessage: string | null;
  resolvedAt: Date | null;
  createdArtifacts: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type IdempotencyRecord = {
  id: string;
  userId: string;
  proposalOutputId: string;
  action: "APPROVE" | "DECLINE" | "RETRY" | "SKIP";
  idempotencyKey: string;
  responseJson: unknown;
};

type AgentSettingRecord = {
  id: string;
  userId: string;
  agentKey: DbAgentKey;
  enabled: boolean;
};

type CreatedArtifactRef = {
  type: "note" | "task";
  id: string;
};

type OutputActionResult = {
  output: ReturnType<typeof toProposalOutputResponse>;
  inboxItem: InboxItemRecord;
};

type AgentConfig = {
  key: ClientAgentKey;
  dbKey: DbAgentKey;
  enabled: boolean;
  serviceName: string;
  payloadVersion: number;
};

type AgentGenerationResult = {
  agentKey: DbAgentKey;
  outputs: Array<{
    outputIndex: number;
    payloadVersion: number;
    payload: unknown;
    payloadPreview: string;
  }>;
  error?: string;
};

type InboxDbTransaction = {
  inboxItem: {
    updateMany: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  inboxProposalOutput: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    upsert: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  inboxProposalActionIdempotency: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
  };
  inboxAgentUserSetting: {
    findMany: (args: unknown) => Promise<unknown[]>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  note: {
    create: (args: unknown) => Promise<unknown>;
  };
  task: {
    create: (args: unknown) => Promise<unknown>;
  };
};

export type InboxDb = InboxDbTransaction & {
  $transaction: <T>(callback: (tx: InboxDbTransaction) => Promise<T>) => Promise<T>;
};

const AGENT_DEFAULTS: AgentConfig[] = [
  {
    key: "kb_note",
    dbKey: "KB_NOTE",
    enabled: true,
    serviceName: "inbox_kb_note",
    payloadVersion: PROPOSAL_PAYLOAD_VERSION,
  },
  {
    key: "todo_list",
    dbKey: "TODO_LIST",
    enabled: true,
    serviceName: "inbox_todo_list",
    payloadVersion: PROPOSAL_PAYLOAD_VERSION,
  },
];

const kbNoteAgentSchema = z.object({
  shouldCreate: z.boolean(),
  reason: z.string().min(1).max(500),
  note: z.union([
    z.object({
      title: z.string().min(1).max(500),
      content: z.string().min(1).max(100000),
    }),
    z.null(),
  ]),
});

const todoListAgentSchema = z.object({
  shouldCreate: z.boolean(),
  reason: z.string().min(1).max(500),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        description: z.union([z.string().max(5000), z.null()]),
        status: z.union([z.enum(["TODO", "IN_PROGRESS", "DONE"]), z.null()]),
        priority: z.union([z.enum(["LOW", "MEDIUM", "HIGH"]), z.null()]),
        dueDate: z.union([z.string(), z.null()]),
      }),
    )
    .max(100),
});

function toDbAgentKey(key: ClientAgentKey): DbAgentKey {
  return key === "kb_note" ? "KB_NOTE" : "TODO_LIST";
}

function toClientAgentKey(key: DbAgentKey): ClientAgentKey {
  return key === "KB_NOTE" ? "kb_note" : "todo_list";
}

function parseDateValue(value: string | null | undefined): Date | null | undefined {
  if (value === null || value === undefined) {
    return value;
  }

  if (value === "") {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}

function toProposalOutputResponse(output: ProposalOutputRecord) {
  return {
    id: output.id,
    userId: output.userId,
    inboxItemId: output.inboxItemId,
    agentKey: toClientAgentKey(output.agentKey),
    outputIndex: output.outputIndex,
    payloadVersion: output.payloadVersion,
    payload: output.payload,
    payloadPreview: output.payloadPreview,
    state: output.state,
    errorMessage: output.errorMessage,
    resolvedAt: output.resolvedAt,
    createdArtifacts: (Array.isArray(output.createdArtifacts)
      ? output.createdArtifacts
      : null) as CreatedArtifactRef[] | null,
    createdAt: output.createdAt,
    updatedAt: output.updatedAt,
  };
}

function parseSnapshotConfig(snapshot: unknown): AgentConfig[] | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const value = snapshot as {
    agents?: Array<{ key?: ClientAgentKey; enabled?: boolean }>;
  };

  if (!Array.isArray(value.agents)) {
    return null;
  }

  const byKey = new Map<ClientAgentKey, boolean>();
  for (const item of value.agents) {
    if (!item?.key) continue;
    if (item.key !== "kb_note" && item.key !== "todo_list") continue;
    byKey.set(item.key, Boolean(item.enabled));
  }

  return AGENT_DEFAULTS.map((agent) => ({
    ...agent,
    enabled: byKey.has(agent.key) ? Boolean(byKey.get(agent.key)) : agent.enabled,
  }));
}

function buildAgentConfigSnapshot(config: AgentConfig[]) {
  return {
    version: 1,
    agents: config.map((agent) => ({
      key: agent.key,
      enabled: agent.enabled,
    })),
  };
}

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

async function getProposalOutputOrThrow(params: {
  db: InboxDbTransaction;
  userId: string;
  outputId: string;
}) {
  const output = (await params.db.inboxProposalOutput.findFirst({
    where: {
      id: params.outputId,
      userId: params.userId,
    },
  })) as ProposalOutputRecord | null;

  if (!output) {
    throw new Error("Inbox proposal output not found");
  }

  return output;
}

function getAgentByDbKey(dbKey: DbAgentKey): AgentConfig {
  const agent = AGENT_DEFAULTS.find((candidate) => candidate.dbKey === dbKey);
  if (!agent) {
    throw new Error(`Unsupported inbox agent: ${dbKey}`);
  }
  return agent;
}

export async function listInboxAgentSettings(params: {
  db: InboxDb;
  userId: string;
}) {
  const rows = (await params.db.inboxAgentUserSetting.findMany({
    where: {
      userId: params.userId,
    },
  })) as AgentSettingRecord[];

  const overrides = new Map(rows.map((row) => [row.agentKey, row.enabled]));

  return AGENT_DEFAULTS.map((agent) => {
    const overrideEnabled = overrides.get(agent.dbKey);
    return {
      key: agent.key,
      defaultEnabled: agent.enabled,
      enabled: overrideEnabled ?? agent.enabled,
      source: overrideEnabled === undefined ? "default" : "user",
    };
  });
}

export async function updateInboxAgentSettings(params: {
  db: InboxDb;
  userId: string;
  input: InboxAgentConfigPatchInput;
}) {
  const parsed = inboxAgentConfigPatchSchema.parse(params.input);

  await Promise.all(
    parsed.agents.map((agent) =>
      params.db.inboxAgentUserSetting.upsert({
        where: {
          userId_agentKey: {
            userId: params.userId,
            agentKey: toDbAgentKey(agent.key),
          },
        },
        create: {
          userId: params.userId,
          agentKey: toDbAgentKey(agent.key),
          enabled: agent.enabled,
        },
        update: {
          enabled: agent.enabled,
        },
      }),
    ),
  );

  return listInboxAgentSettings({
    db: params.db,
    userId: params.userId,
  });
}

async function getEffectiveAgentConfig(params: {
  db: InboxDb;
  userId: string;
}) {
  const rows = (await params.db.inboxAgentUserSetting.findMany({
    where: {
      userId: params.userId,
    },
  })) as AgentSettingRecord[];

  const overrideByKey = new Map(rows.map((row) => [row.agentKey, row.enabled]));

  return AGENT_DEFAULTS.map((agent) => ({
    ...agent,
    enabled:
      overrideByKey.get(agent.dbKey) === undefined
        ? agent.enabled
        : Boolean(overrideByKey.get(agent.dbKey)),
  }));
}

async function syncInboxItemStateFromOutputs(params: {
  db: InboxDbTransaction;
  userId: string;
  inboxItemId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const item = (await params.db.inboxItem.findFirst({
    where: {
      id: params.inboxItemId,
      userId: params.userId,
    },
  })) as InboxItemRecord | null;

  if (!item) {
    throw new Error("Inbox item not found");
  }

  const outputs = (await params.db.inboxProposalOutput.findMany({
    where: {
      inboxItemId: params.inboxItemId,
      userId: params.userId,
    },
    select: {
      state: true,
    },
  })) as Array<{ state: ProposalOutputState }>;

  if (outputs.length === 0) {
    return (await params.db.inboxItem.update({
      where: {
        id: params.inboxItemId,
      },
      data: {
        state: "PROCESSED",
        processedAt: item.processedAt ?? now,
      },
    })) as InboxItemRecord;
  }

  const hasFailed = outputs.some((output) => output.state === "FAILED");
  if (hasFailed) {
    return (await params.db.inboxItem.update({
      where: {
        id: params.inboxItemId,
      },
      data: {
        state: "REVIEW",
      },
    })) as InboxItemRecord;
  }

  const allTerminal = outputs.every((output) =>
    output.state === "APPROVED" ||
    output.state === "DECLINED" ||
    output.state === "SKIPPED",
  );

  if (allTerminal) {
    return (await params.db.inboxItem.update({
      where: {
        id: params.inboxItemId,
      },
      data: {
        state: "PROCESSED",
        processedAt: item.processedAt ?? now,
      },
    })) as InboxItemRecord;
  }

  return (await params.db.inboxItem.update({
    where: {
      id: params.inboxItemId,
    },
    data: {
      state: "REVIEW",
    },
  })) as InboxItemRecord;
}

async function callAgentWithTimeout<T extends z.ZodTypeAny>(params: {
  serviceName: string;
  prompt: string;
  schema: T;
  timeoutMs: number;
}) {
  const model = getModelFor(params.serviceName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    return await callJson(model, {
      prompt: params.prompt,
      schema: params.schema,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildKbNotePrompt(content: string) {
  return `You are generating a draft knowledge-base note proposal from an inbox capture.

Rules:
- Decide if a structured note should be created.
- If the capture is too short/noisy/not useful, set shouldCreate=false.
- If shouldCreate=true, provide a clear title and markdown content.
- Keep markdown concise and useful.
- Return JSON only.

Inbox Capture:
${content}`;
}

function buildTodoListPrompt(content: string) {
  return `You are extracting actionable tasks from an inbox capture.

Rules:
- Decide if tasks should be created.
- If no clear actions exist, set shouldCreate=false.
- If shouldCreate=true, produce tasks array with concrete action titles.
- Optional fields: description, status, priority, dueDate.
- dueDate may be YYYY-MM-DD, ISO datetime string, or null.
- Return JSON only.

Inbox Capture:
${content}`;
}

async function runKbNoteAgent(params: {
  content: string;
  agent: AgentConfig;
}): Promise<AgentGenerationResult> {
  try {
    const response = await callAgentWithTimeout({
      serviceName: params.agent.serviceName,
      prompt: buildKbNotePrompt(params.content),
      schema: kbNoteAgentSchema,
      timeoutMs: AGENT_TIMEOUT_MS,
    });

    if (!response.shouldCreate || !response.note) {
      return {
        agentKey: params.agent.dbKey,
        outputs: [],
      };
    }

    return {
      agentKey: params.agent.dbKey,
      outputs: [
        {
          outputIndex: 0,
          payloadVersion: params.agent.payloadVersion,
          payload: {
            title: response.note.title,
            content: response.note.content,
          },
          payloadPreview: `${response.reason} (Create note: ${response.note.title})`,
        },
      ],
    };
  } catch (error) {
    return {
      agentKey: params.agent.dbKey,
      outputs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runTodoListAgent(params: {
  content: string;
  agent: AgentConfig;
}): Promise<AgentGenerationResult> {
  try {
    const response = await callAgentWithTimeout({
      serviceName: params.agent.serviceName,
      prompt: buildTodoListPrompt(params.content),
      schema: todoListAgentSchema,
      timeoutMs: AGENT_TIMEOUT_MS,
    });

    const tasks = response.tasks ?? [];
    const normalizedTasks = tasks.map((task) => ({
      title: task.title,
      description: task.description ?? undefined,
      status: task.status ?? undefined,
      priority: task.priority ?? undefined,
      dueDate: task.dueDate ?? undefined,
    }));

    if (!response.shouldCreate || normalizedTasks.length === 0) {
      return {
        agentKey: params.agent.dbKey,
        outputs: [],
      };
    }

    return {
      agentKey: params.agent.dbKey,
      outputs: [
        {
          outputIndex: 0,
          payloadVersion: params.agent.payloadVersion,
          payload: {
            tasks: normalizedTasks,
          },
          payloadPreview: `${response.reason} (Create ${normalizedTasks.length} task${normalizedTasks.length === 1 ? "" : "s"})`,
        },
      ],
    };
  } catch (error) {
    return {
      agentKey: params.agent.dbKey,
      outputs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runAgent(params: {
  content: string;
  agent: AgentConfig;
}): Promise<AgentGenerationResult> {
  if (params.agent.key === "kb_note") {
    return runKbNoteAgent(params);
  }

  return runTodoListAgent(params);
}

async function upsertGeneratedOutputs(params: {
  db: InboxDb;
  userId: string;
  inboxItemId: string;
  result: AgentGenerationResult;
}) {
  await Promise.all(
    params.result.outputs.map((output) =>
      params.db.inboxProposalOutput.upsert({
        where: {
          inboxItemId_agentKey_outputIndex: {
            inboxItemId: params.inboxItemId,
            agentKey: params.result.agentKey,
            outputIndex: output.outputIndex,
          },
        },
        create: {
          userId: params.userId,
          inboxItemId: params.inboxItemId,
          agentKey: params.result.agentKey,
          outputIndex: output.outputIndex,
          payloadVersion: output.payloadVersion,
          payload: output.payload,
          payloadPreview: output.payloadPreview,
          state: "PENDING",
        },
        update: {
          payloadVersion: output.payloadVersion,
          payload: output.payload,
          payloadPreview: output.payloadPreview,
          state: "PENDING",
          errorMessage: null,
          resolvedAt: null,
          createdArtifacts: null,
        },
      }),
    ),
  );
}

export async function startInboxProposalGeneration(params: {
  getDb: () => Promise<InboxDb>;
  userId: string;
  inboxItemId: string;
}) {
  const db = await params.getDb();
  const item = await getInboxItemOrThrow({
    db,
    userId: params.userId,
    id: params.inboxItemId,
  });

  if (item.state !== "PROCESSING") {
    return item;
  }

  const snapshotConfig = parseSnapshotConfig(item.agentConfigSnapshot);
  const effectiveConfig = snapshotConfig ?? (await getEffectiveAgentConfig({ db, userId: params.userId }));

  const enabledAgents = effectiveConfig.filter((agent) => agent.enabled);
  if (enabledAgents.length === 0) {
    return db.inboxItem.update({
      where: {
        id: item.id,
      },
      data: {
        state: "PROCESSED",
        processedAt: item.processedAt ?? new Date(),
        processingError: null,
      },
    }) as Promise<InboxItemRecord>;
  }

  const results = await Promise.all(
    enabledAgents.map((agent) =>
      runAgent({
        content: item.content,
        agent,
      }),
    ),
  );

  await Promise.all(
    results.map((result) =>
      upsertGeneratedOutputs({
        db,
        userId: params.userId,
        inboxItemId: item.id,
        result,
      }),
    ),
  );

  const errors = results
    .filter((result) => Boolean(result.error))
    .map((result) => `${toClientAgentKey(result.agentKey)}: ${result.error}`);

  const generatedCount = results.reduce((count, result) => count + result.outputs.length, 0);

  if (generatedCount === 0 && errors.length === 0) {
    return db.inboxItem.update({
      where: { id: item.id },
      data: {
        state: "PROCESSED",
        processedAt: item.processedAt ?? new Date(),
        processingError: null,
      },
    }) as Promise<InboxItemRecord>;
  }

  return db.inboxItem.update({
    where: {
      id: item.id,
    },
    data: {
      state: "REVIEW",
      processingError: errors.length > 0 ? errors.join(" | ") : null,
    },
  }) as Promise<InboxItemRecord>;
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
  now?: Date;
}) {
  const parsed = createInboxItemSchema.parse(params.input ?? {});
  const now = params.now ?? new Date();

  const effectiveConfig = await getEffectiveAgentConfig({
    db: params.db,
    userId: params.userId,
  });

  return params.db.inboxItem.create({
    data: {
      userId: params.userId,
      content: parsed.content,
      state: "PROCESSING",
      processingStartedAt: now,
      processingError: null,
      agentConfigSnapshot: buildAgentConfigSnapshot(effectiveConfig),
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

  return params.db.$transaction(async (tx) => {
    const item = await getInboxItemOrThrow({
      db: tx as InboxDb,
      userId: params.userId,
      id: parsed.id,
    });

    if (item.state === "ARCHIVED") {
      throw new Error("Archived inbox items cannot be processed");
    }

    await tx.inboxProposalOutput.updateMany({
      where: {
        userId: params.userId,
        inboxItemId: parsed.id,
        state: "PENDING",
      },
      data: {
        state: "DECLINED",
        resolvedAt: now,
        errorMessage: null,
      },
    });

    await tx.inboxProposalOutput.updateMany({
      where: {
        userId: params.userId,
        inboxItemId: parsed.id,
        state: "FAILED",
      },
      data: {
        state: "SKIPPED",
        resolvedAt: now,
      },
    });

    return syncInboxItemStateFromOutputs({
      db: tx,
      userId: params.userId,
      inboxItemId: parsed.id,
      now,
    });
  });
}

export async function recoverInboxItem(params: {
  db: InboxDb;
  userId: string;
  input: RecoverInboxItemInput;
  now?: Date;
}) {
  const parsed = recoverInboxItemSchema.parse(params.input);
  const now = params.now ?? new Date();

  const item = await getInboxItemOrThrow({
    db: params.db,
    userId: params.userId,
    id: parsed.id,
  });

  if (item.state !== "PROCESSING") {
    throw new Error("Only processing inbox items can be recovered");
  }

  const startedAt = item.processingStartedAt ?? item.createdAt;
  const processingAgeMs = now.getTime() - startedAt.getTime();

  if (processingAgeMs < PROCESSING_RECOVERY_WINDOW_MS) {
    throw new Error("Inbox item is not eligible for recovery yet");
  }

  const updated = (await params.db.inboxItem.update({
    where: {
      id: parsed.id,
    },
    data: {
      state: "REVIEW",
      processingError: "Processing timed out and was manually recovered.",
    },
  })) as InboxItemRecord;

  const outputs = (await params.db.inboxProposalOutput.findMany({
    where: {
      userId: params.userId,
      inboxItemId: parsed.id,
    },
    select: {
      id: true,
    },
  })) as Array<{ id: string }>;

  if (outputs.length === 0) {
    return params.db.inboxItem.update({
      where: { id: parsed.id },
      data: {
        state: "PROCESSED",
        processedAt: updated.processedAt ?? now,
      },
    });
  }

  return updated;
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

export async function listInboxProposalOutputs(params: {
  db: InboxDb;
  userId: string;
  input: GetInboxOutputsInput;
}) {
  const parsed = getInboxOutputsSchema.parse(params.input);

  await getInboxItemOrThrow({
    db: params.db,
    userId: params.userId,
    id: parsed.itemId,
  });

  const outputs = (await params.db.inboxProposalOutput.findMany({
    where: {
      userId: params.userId,
      inboxItemId: parsed.itemId,
    },
    orderBy: OUTPUT_ORDER,
  })) as ProposalOutputRecord[];

  return outputs.map(toProposalOutputResponse);
}

async function getStoredIdempotentActionResult(params: {
  db: InboxDbTransaction;
  userId: string;
  outputId: string;
  action: "APPROVE" | "DECLINE" | "RETRY" | "SKIP";
  idempotencyKey: string;
}) {
  const existing = (await params.db.inboxProposalActionIdempotency.findFirst({
    where: {
      userId: params.userId,
      proposalOutputId: params.outputId,
      action: params.action,
      idempotencyKey: params.idempotencyKey,
    },
  })) as IdempotencyRecord | null;

  if (!existing) {
    return null;
  }

  return existing.responseJson as OutputActionResult;
}

async function storeIdempotentActionResult(params: {
  db: InboxDbTransaction;
  userId: string;
  outputId: string;
  action: "APPROVE" | "DECLINE" | "RETRY" | "SKIP";
  idempotencyKey: string;
  response: OutputActionResult;
}) {
  const serializedResponse = JSON.parse(JSON.stringify(params.response));

  await params.db.inboxProposalActionIdempotency.create({
    data: {
      userId: params.userId,
      proposalOutputId: params.outputId,
      action: params.action,
      idempotencyKey: params.idempotencyKey,
      responseJson: serializedResponse,
    },
  });

  return serializedResponse as OutputActionResult;
}

async function withIdempotentOutputAction(params: {
  db: InboxDb;
  userId: string;
  outputId: string;
  action: "APPROVE" | "DECLINE" | "RETRY" | "SKIP";
  idempotencyKey: string;
  run: (tx: InboxDbTransaction) => Promise<OutputActionResult>;
}) {
  return params.db.$transaction(async (tx) => {
    const existing = await getStoredIdempotentActionResult({
      db: tx,
      userId: params.userId,
      outputId: params.outputId,
      action: params.action,
      idempotencyKey: params.idempotencyKey,
    });

    if (existing) {
      return existing;
    }

    const response = await params.run(tx);
    return storeIdempotentActionResult({
      db: tx,
      userId: params.userId,
      outputId: params.outputId,
      action: params.action,
      idempotencyKey: params.idempotencyKey,
      response,
    });
  });
}

async function executeKbNoteApproval(params: {
  tx: InboxDbTransaction;
  output: ProposalOutputRecord;
  userId: string;
  now: Date;
}) {
  const payload = kbNotePayloadSchema.parse(params.output.payload);

  const note = (await params.tx.note.create({
    data: {
      userId: params.userId,
      title: payload.title,
      content: payload.content,
      projectId: null,
    },
    select: {
      id: true,
    },
  })) as { id: string };

  const createdArtifacts: CreatedArtifactRef[] = [
    {
      type: "note",
      id: note.id,
    },
  ];

  return (await params.tx.inboxProposalOutput.update({
    where: {
      id: params.output.id,
    },
    data: {
      state: "APPROVED",
      resolvedAt: params.now,
      errorMessage: null,
      createdArtifacts,
    },
  })) as ProposalOutputRecord;
}

async function executeTodoListApproval(params: {
  tx: InboxDbTransaction;
  output: ProposalOutputRecord;
  userId: string;
  now: Date;
}) {
  const payload = todoListPayloadSchema.parse(params.output.payload);
  const createdArtifacts: CreatedArtifactRef[] = [];

  for (const task of payload.tasks) {
    const createdTask = (await params.tx.task.create({
      data: {
        userId: params.userId,
        title: task.title,
        description: task.description,
        status: task.status ?? "TODO",
        priority: task.priority ?? "MEDIUM",
        dueDate: parseDateValue(task.dueDate),
        projectId: null,
      },
      select: {
        id: true,
      },
    })) as { id: string };

    createdArtifacts.push({
      type: "task",
      id: createdTask.id,
    });
  }

  return (await params.tx.inboxProposalOutput.update({
    where: {
      id: params.output.id,
    },
    data: {
      state: "APPROVED",
      resolvedAt: params.now,
      errorMessage: null,
      createdArtifacts,
    },
  })) as ProposalOutputRecord;
}

async function executeApprovalWithExistingPayload(params: {
  tx: InboxDbTransaction;
  output: ProposalOutputRecord;
  userId: string;
  now: Date;
}) {
  if (params.output.agentKey === "KB_NOTE") {
    return executeKbNoteApproval(params);
  }

  return executeTodoListApproval(params);
}

async function applyApproveOutput(params: {
  tx: InboxDbTransaction;
  output: ProposalOutputRecord;
  userId: string;
  now: Date;
}) {
  if (params.output.state === "APPROVED") {
    return params.output;
  }

  if (params.output.state !== "PENDING") {
    throw new Error("Only pending outputs can be approved");
  }

  try {
    return await executeApprovalWithExistingPayload(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (await params.tx.inboxProposalOutput.update({
      where: {
        id: params.output.id,
      },
      data: {
        state: "FAILED",
        resolvedAt: null,
        errorMessage: message,
      },
    })) as ProposalOutputRecord;
  }
}

async function applyRetryOutput(params: {
  tx: InboxDbTransaction;
  output: ProposalOutputRecord;
  userId: string;
  now: Date;
}) {
  if (params.output.state !== "FAILED") {
    throw new Error("Only failed outputs can be retried");
  }

  try {
    return await executeApprovalWithExistingPayload(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (await params.tx.inboxProposalOutput.update({
      where: {
        id: params.output.id,
      },
      data: {
        state: "FAILED",
        resolvedAt: null,
        errorMessage: message,
      },
    })) as ProposalOutputRecord;
  }
}

async function applyDeclineOutput(params: {
  tx: InboxDbTransaction;
  output: ProposalOutputRecord;
  now: Date;
}) {
  if (params.output.state === "DECLINED") {
    return params.output;
  }

  if (params.output.state !== "PENDING") {
    throw new Error("Only pending outputs can be declined");
  }

  return (await params.tx.inboxProposalOutput.update({
    where: {
      id: params.output.id,
    },
    data: {
      state: "DECLINED",
      resolvedAt: params.now,
      errorMessage: null,
    },
  })) as ProposalOutputRecord;
}

async function applySkipOutput(params: {
  tx: InboxDbTransaction;
  output: ProposalOutputRecord;
  now: Date;
  reason?: string;
}) {
  if (params.output.state === "SKIPPED") {
    return params.output;
  }

  if (params.output.state !== "FAILED") {
    throw new Error("Only failed outputs can be skipped");
  }

  return (await params.tx.inboxProposalOutput.update({
    where: {
      id: params.output.id,
    },
    data: {
      state: "SKIPPED",
      resolvedAt: params.now,
      ...(params.reason
        ? {
            errorMessage: `Skipped: ${params.reason}`,
          }
        : {}),
    },
  })) as ProposalOutputRecord;
}

export async function approveInboxProposalOutput(params: {
  db: InboxDb;
  userId: string;
  input: ResolveInboxOutputInput;
  now?: Date;
}) {
  const parsed = resolveInboxOutputSchema.parse(params.input);
  const now = params.now ?? new Date();

  return withIdempotentOutputAction({
    db: params.db,
    userId: params.userId,
    outputId: parsed.outputId,
    action: "APPROVE",
    idempotencyKey: parsed.idempotencyKey,
    run: async (tx) => {
      const output = await getProposalOutputOrThrow({
        db: tx,
        userId: params.userId,
        outputId: parsed.outputId,
      });

      const nextOutput = await applyApproveOutput({
        tx,
        output,
        userId: params.userId,
        now,
      });

      const nextItem = await syncInboxItemStateFromOutputs({
        db: tx,
        userId: params.userId,
        inboxItemId: nextOutput.inboxItemId,
        now,
      });

      return {
        output: toProposalOutputResponse(nextOutput),
        inboxItem: nextItem,
      };
    },
  });
}

export async function declineInboxProposalOutput(params: {
  db: InboxDb;
  userId: string;
  input: ResolveInboxOutputInput;
  now?: Date;
}) {
  const parsed = resolveInboxOutputSchema.parse(params.input);
  const now = params.now ?? new Date();

  return withIdempotentOutputAction({
    db: params.db,
    userId: params.userId,
    outputId: parsed.outputId,
    action: "DECLINE",
    idempotencyKey: parsed.idempotencyKey,
    run: async (tx) => {
      const output = await getProposalOutputOrThrow({
        db: tx,
        userId: params.userId,
        outputId: parsed.outputId,
      });

      const nextOutput = await applyDeclineOutput({
        tx,
        output,
        now,
      });

      const nextItem = await syncInboxItemStateFromOutputs({
        db: tx,
        userId: params.userId,
        inboxItemId: nextOutput.inboxItemId,
        now,
      });

      return {
        output: toProposalOutputResponse(nextOutput),
        inboxItem: nextItem,
      };
    },
  });
}

export async function retryInboxProposalOutput(params: {
  db: InboxDb;
  userId: string;
  input: ResolveInboxOutputInput;
  now?: Date;
}) {
  const parsed = resolveInboxOutputSchema.parse(params.input);
  const now = params.now ?? new Date();

  return withIdempotentOutputAction({
    db: params.db,
    userId: params.userId,
    outputId: parsed.outputId,
    action: "RETRY",
    idempotencyKey: parsed.idempotencyKey,
    run: async (tx) => {
      const output = await getProposalOutputOrThrow({
        db: tx,
        userId: params.userId,
        outputId: parsed.outputId,
      });

      const nextOutput = await applyRetryOutput({
        tx,
        output,
        userId: params.userId,
        now,
      });

      const nextItem = await syncInboxItemStateFromOutputs({
        db: tx,
        userId: params.userId,
        inboxItemId: nextOutput.inboxItemId,
        now,
      });

      return {
        output: toProposalOutputResponse(nextOutput),
        inboxItem: nextItem,
      };
    },
  });
}

export async function skipInboxProposalOutput(params: {
  db: InboxDb;
  userId: string;
  input: SkipInboxOutputInput;
  now?: Date;
}) {
  const parsed = skipInboxOutputSchema.parse(params.input);
  const now = params.now ?? new Date();

  return withIdempotentOutputAction({
    db: params.db,
    userId: params.userId,
    outputId: parsed.outputId,
    action: "SKIP",
    idempotencyKey: parsed.idempotencyKey,
    run: async (tx) => {
      const output = await getProposalOutputOrThrow({
        db: tx,
        userId: params.userId,
        outputId: parsed.outputId,
      });

      const nextOutput = await applySkipOutput({
        tx,
        output,
        now,
        reason: parsed.reason,
      });

      const nextItem = await syncInboxItemStateFromOutputs({
        db: tx,
        userId: params.userId,
        inboxItemId: nextOutput.inboxItemId,
        now,
      });

      return {
        output: toProposalOutputResponse(nextOutput),
        inboxItem: nextItem,
      };
    },
  });
}

type BulkResolveResult = {
  outputId: string;
  state: "updated" | "unchanged" | "failed";
  output: ReturnType<typeof toProposalOutputResponse>;
  error?: string;
};

async function loadItemOutputsForBulk(params: {
  db: InboxDb;
  userId: string;
  itemId: string;
}) {
  await getInboxItemOrThrow({
    db: params.db,
    userId: params.userId,
    id: params.itemId,
  });

  return (await params.db.inboxProposalOutput.findMany({
    where: {
      userId: params.userId,
      inboxItemId: params.itemId,
    },
    orderBy: OUTPUT_ORDER,
  })) as ProposalOutputRecord[];
}

export async function approveAllInboxProposalOutputs(params: {
  db: InboxDb;
  userId: string;
  input: BulkResolveInboxOutputsInput;
  now?: Date;
}) {
  const parsed = bulkResolveInboxOutputsSchema.parse(params.input);
  const now = params.now ?? new Date();
  const outputs = await loadItemOutputsForBulk({
    db: params.db,
    userId: params.userId,
    itemId: parsed.itemId,
  });

  const results: BulkResolveResult[] = [];

  for (const output of outputs) {
    if (output.state === "APPROVED" || output.state === "DECLINED" || output.state === "SKIPPED") {
      results.push({
        outputId: output.id,
        state: "unchanged",
        output: toProposalOutputResponse(output),
      });
      continue;
    }

    if (output.state === "FAILED") {
      results.push({
        outputId: output.id,
        state: "failed",
        output: toProposalOutputResponse(output),
        error: "Failed outputs require retry",
      });
      continue;
    }

    try {
      const response = await approveInboxProposalOutput({
        db: params.db,
        userId: params.userId,
        input: {
          outputId: output.id,
          idempotencyKey: `${parsed.idempotencyKey}:approve:${output.id}`,
        },
        now,
      });
      results.push({
        outputId: output.id,
        state: "updated",
        output: response.output,
      });
    } catch (error) {
      results.push({
        outputId: output.id,
        state: "failed",
        output: toProposalOutputResponse(output),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const inboxItem = await syncInboxItemStateFromOutputs({
    db: params.db,
    userId: params.userId,
    inboxItemId: parsed.itemId,
    now,
  });

  return {
    itemId: parsed.itemId,
    inboxItem,
    results,
  };
}

export async function declineAllInboxProposalOutputs(params: {
  db: InboxDb;
  userId: string;
  input: BulkResolveInboxOutputsInput;
  now?: Date;
}) {
  const parsed = bulkResolveInboxOutputsSchema.parse(params.input);
  const now = params.now ?? new Date();
  const outputs = await loadItemOutputsForBulk({
    db: params.db,
    userId: params.userId,
    itemId: parsed.itemId,
  });

  const results: BulkResolveResult[] = [];

  for (const output of outputs) {
    if (output.state === "APPROVED" || output.state === "DECLINED" || output.state === "SKIPPED") {
      results.push({
        outputId: output.id,
        state: "unchanged",
        output: toProposalOutputResponse(output),
      });
      continue;
    }

    if (output.state === "FAILED") {
      results.push({
        outputId: output.id,
        state: "failed",
        output: toProposalOutputResponse(output),
        error: "Failed outputs require skip or retry",
      });
      continue;
    }

    try {
      const response = await declineInboxProposalOutput({
        db: params.db,
        userId: params.userId,
        input: {
          outputId: output.id,
          idempotencyKey: `${parsed.idempotencyKey}:decline:${output.id}`,
        },
        now,
      });
      results.push({
        outputId: output.id,
        state: "updated",
        output: response.output,
      });
    } catch (error) {
      results.push({
        outputId: output.id,
        state: "failed",
        output: toProposalOutputResponse(output),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const inboxItem = await syncInboxItemStateFromOutputs({
    db: params.db,
    userId: params.userId,
    inboxItemId: parsed.itemId,
    now,
  });

  return {
    itemId: parsed.itemId,
    inboxItem,
    results,
  };
}

export function queueInboxProposalGeneration(params: {
  getDb: () => Promise<InboxDb>;
  userId: string;
  inboxItemId: string;
}) {
  void startInboxProposalGeneration(params).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    logger.warn("Failed to generate inbox proposals", {
      inboxItemId: params.inboxItemId,
      userId: params.userId,
      error: message,
    });

    void params
      .getDb()
      .then((db) =>
        db.inboxItem.updateMany({
          where: {
            id: params.inboxItemId,
            userId: params.userId,
            state: "PROCESSING",
          },
          data: {
            state: "REVIEW",
            processingError: `generation_failed: ${message}`,
          },
        }),
      )
      .catch((updateError) => {
        logger.warn("Failed to persist inbox proposal generation error", {
          inboxItemId: params.inboxItemId,
          userId: params.userId,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        });
      });
  });
}

export const _private = {
  toDbAgentKey,
  toClientAgentKey,
  parseSnapshotConfig,
  buildAgentConfigSnapshot,
  getAgentByDbKey,
};
