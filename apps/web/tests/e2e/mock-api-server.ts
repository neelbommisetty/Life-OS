type SessionUser = {
  id: string;
  name: string;
  email: string;
};

type MockProject = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  aiInstructions: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MockTask = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueDate: string | null;
  deletedAt: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MockNote = {
  id: string;
  userId: string;
  title: string;
  content: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  sourceMessageId: string | null;
};

type MockChatThread = {
  id: string;
  userId: string;
  name: string;
  modelKey: string | null;
  summary: string | null;
  summaryUpTo: string | null;
  lastChattedAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
};

type MockChatMessage = {
  id: string;
  threadId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
  modelKey: string | null;
  modelLabel: string | null;
  modelProvider: string | null;
  tokenCount: number | null;
  tokenCountSource: "ESTIMATE" | "PROVIDER" | null;
  savedNoteId: string | null;
};

type MockInboxItemState =
  | "SAVED"
  | "PROCESSING"
  | "REVIEW"
  | "PROCESSED"
  | "ARCHIVED";

type MockInboxItem = {
  id: string;
  userId: string;
  content: string;
  state: MockInboxItemState;
  processedAt: string | null;
  archivedAt: string | null;
  processingStartedAt: string | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
};

type MockInboxOutput = {
  id: string;
  userId: string;
  inboxItemId: string;
  agentKey: "kb_note" | "todo_list";
  outputIndex: number;
  payloadVersion: number;
  payload: unknown;
  payloadPreview: string;
  state: "PENDING" | "APPROVED" | "DECLINED" | "FAILED" | "SKIPPED";
  errorMessage: string | null;
  resolvedAt: string | null;
  createdArtifacts: Array<{ type: "note" | "task"; id: string }> | null;
  createdAt: string;
  updatedAt: string;
};

type MockAnalyticsSummary = {
  totals: {
    totalCalls: number;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  byModel: Array<{
    modelKey: string | null;
    callCount: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byThread: Array<{
    threadId: string;
    threadName: string | null;
    callCount: number;
    costUsd: number;
  }>;
  byCallType: Array<{
    callType: string;
    callCount: number;
    costUsd: number;
  }>;
};

type MockRecentAiCall = {
  id: string;
  callType: string;
  modelKey: string | null;
  providerId: string;
  status: string;
  costUsd: number;
  totalLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requestStartAt: string;
  threadId: string | null;
  threadName: string | null;
};

type SessionState = {
  user: SessionUser;
  projects: MockProject[];
  tasks: MockTask[];
  notes: MockNote[];
  chatThreads: MockChatThread[];
  chatMessagesByThread: Record<string, MockChatMessage[]>;
  inboxItems: MockInboxItem[];
  inboxOutputsByItem: Record<string, MockInboxOutput[]>;
  analyticsSummary: MockAnalyticsSummary;
  analyticsRecentCalls: MockRecentAiCall[];
};

const port = Number(process.env.PLAYWRIGHT_API_PORT ?? 3201);
const SESSION_COOKIE = "mock-session";
const SCENARIO_COOKIE = "mock-scenario";
const INVALID_SESSION = "invalid";
const DEMO_EMAIL = "demo@lifeos.dev";
const DEMO_PASSWORD = "demo12345";

const sessionStore = new Map<string, SessionState>();
let idCounter = 0;

function cuid() {
  idCounter += 1;
  return `c${idCounter.toString(36).padStart(24, "0")}`;
}

function iso(value: Date) {
  return value.toISOString();
}

function nowMinus(minutes: number) {
  return new Date(Date.now() - minutes * 60_000);
}

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function readCookie(request: Request, cookieName: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookiePart = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));

  if (!cookiePart) {
    return null;
  }

  return cookiePart.slice(cookieName.length + 1);
}

function parseScenarioFlags(request: Request) {
  const raw = readCookie(request, SCENARIO_COOKIE);
  if (!raw) {
    return new Set<string>();
  }

  return new Set(
    raw
      .split(/[\s,]+/)
      .map((flag) => flag.trim())
      .filter(Boolean),
  );
}

function hasScenario(flags: Set<string>, flag: string) {
  return flags.has(flag);
}

function parseDateFromInput(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toPublicProject(project: MockProject) {
  return {
    ...project,
  };
}

function toPublicTask(task: MockTask, state: SessionState) {
  const project = task.projectId
    ? state.projects.find((candidate) => candidate.id === task.projectId) ?? null
    : null;

  return {
    ...task,
    project: project
      ? {
          id: project.id,
          userId: project.userId,
          name: project.name,
          description: project.description,
          aiInstructions: project.aiInstructions,
          archivedAt: project.archivedAt,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }
      : null,
  };
}

function toPublicNote(note: MockNote, state: SessionState) {
  const project = note.projectId
    ? state.projects.find((candidate) => candidate.id === note.projectId) ?? null
    : null;

  return {
    ...note,
    project: project
      ? {
          id: project.id,
          userId: project.userId,
          name: project.name,
          description: project.description,
          aiInstructions: project.aiInstructions,
          archivedAt: project.archivedAt,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }
      : null,
  };
}

function toPublicThread(thread: MockChatThread, state: SessionState) {
  const project = thread.projectId
    ? state.projects.find((candidate) => candidate.id === thread.projectId) ?? null
    : null;

  return {
    ...thread,
    project: project
      ? {
          id: project.id,
          userId: project.userId,
          name: project.name,
          description: project.description,
          aiInstructions: project.aiInstructions,
          archivedAt: project.archivedAt,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        }
      : null,
  };
}

function isSessionAuthenticated(request: Request) {
  const sessionCookie = readCookie(request, SESSION_COOKIE);
  return Boolean(sessionCookie && sessionCookie !== INVALID_SESSION);
}

function getSessionId(request: Request) {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value || value === INVALID_SESSION) {
    return null;
  }

  return value;
}

function unauthorized() {
  return jsonResponse(
    {
      error: "unauthorized",
      message: "Unauthorized",
    },
    401,
  );
}

function createSessionState(user: SessionUser): SessionState {
  const projectMainId = cuid();
  const projectSecondId = cuid();

  const now = new Date();

  const projects: MockProject[] = [
    {
      id: projectMainId,
      userId: user.id,
      name: "Life Admin",
      description: "Primary project used for e2e flows.",
      aiInstructions: "Keep responses concise.",
      archivedAt: null,
      createdAt: iso(nowMinus(300)),
      updatedAt: iso(nowMinus(3)),
    },
    {
      id: projectSecondId,
      userId: user.id,
      name: "Website Redesign",
      description: "Secondary seeded project.",
      aiInstructions: null,
      archivedAt: null,
      createdAt: iso(nowMinus(600)),
      updatedAt: iso(nowMinus(120)),
    },
  ];

  const tasks: MockTask[] = [
    {
      id: cuid(),
      userId: user.id,
      title: "Seed TODO task",
      description: "Task in TODO column",
      status: "TODO",
      priority: "MEDIUM",
      dueDate: iso(nowMinus(-1440)),
      deletedAt: null,
      projectId: projectMainId,
      createdAt: iso(nowMinus(200)),
      updatedAt: iso(nowMinus(10)),
    },
    {
      id: cuid(),
      userId: user.id,
      title: "Seed IN_PROGRESS task",
      description: "Task in progress",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: iso(nowMinus(-2880)),
      deletedAt: null,
      projectId: projectMainId,
      createdAt: iso(nowMinus(180)),
      updatedAt: iso(nowMinus(20)),
    },
    {
      id: cuid(),
      userId: user.id,
      title: "Seed DONE task",
      description: "Completed task",
      status: "DONE",
      priority: "LOW",
      dueDate: null,
      deletedAt: null,
      projectId: projectSecondId,
      createdAt: iso(nowMinus(160)),
      updatedAt: iso(nowMinus(30)),
    },
    {
      id: cuid(),
      userId: user.id,
      title: "Archived seed task",
      description: "Archived task entry",
      status: "DONE",
      priority: "LOW",
      dueDate: null,
      deletedAt: iso(nowMinus(90)),
      projectId: projectSecondId,
      createdAt: iso(nowMinus(220)),
      updatedAt: iso(nowMinus(90)),
    },
  ];

  const notes: MockNote[] = [
    {
      id: cuid(),
      userId: user.id,
      title: "First note",
      content: "First note body sentinel",
      deletedAt: null,
      createdAt: iso(nowMinus(100)),
      updatedAt: iso(nowMinus(2)),
      projectId: null,
      sourceMessageId: null,
    },
    {
      id: cuid(),
      userId: user.id,
      title: "Second note",
      content: "Second note body sentinel",
      deletedAt: null,
      createdAt: iso(nowMinus(110)),
      updatedAt: iso(nowMinus(5)),
      projectId: projectMainId,
      sourceMessageId: null,
    },
  ];

  const threadAId = cuid();
  const threadBId = cuid();
  const projectThreadId = cuid();

  const chatThreads: MockChatThread[] = [
    {
      id: threadAId,
      userId: user.id,
      name: "Thread A",
      modelKey: null,
      summary: null,
      summaryUpTo: null,
      lastChattedAt: iso(nowMinus(1)),
      archivedAt: null,
      createdAt: iso(nowMinus(200)),
      updatedAt: iso(nowMinus(1)),
      projectId: null,
    },
    {
      id: threadBId,
      userId: user.id,
      name: "Thread B",
      modelKey: null,
      summary: null,
      summaryUpTo: null,
      lastChattedAt: iso(nowMinus(6)),
      archivedAt: null,
      createdAt: iso(nowMinus(220)),
      updatedAt: iso(nowMinus(6)),
      projectId: null,
    },
    {
      id: projectThreadId,
      userId: user.id,
      name: "Project Thread 1",
      modelKey: null,
      summary: null,
      summaryUpTo: null,
      lastChattedAt: iso(nowMinus(12)),
      archivedAt: null,
      createdAt: iso(nowMinus(240)),
      updatedAt: iso(nowMinus(12)),
      projectId: projectMainId,
    },
  ];

  function buildThreadMessages(
    threadId: string,
    label: string,
    count: number,
  ): MockChatMessage[] {
    return Array.from({ length: count }, (_, index) => {
      const role = index % 2 === 0 ? "USER" : "ASSISTANT";
      return {
        id: cuid(),
        threadId,
        role,
        content: `${label} message ${index + 1}`,
        createdAt: iso(new Date(now.getTime() - (count - index) * 60_000)),
        modelKey: role === "ASSISTANT" ? "anthropic.claude-haiku-4-5" : null,
        modelLabel: role === "ASSISTANT" ? "Anthropic Claude Haiku 4.5" : null,
        modelProvider: role === "ASSISTANT" ? "anthropic" : null,
        tokenCount: role === "ASSISTANT" ? 42 : null,
        tokenCountSource: role === "ASSISTANT" ? "ESTIMATE" : null,
        savedNoteId: null,
      };
    });
  }

  const chatMessagesByThread: Record<string, MockChatMessage[]> = {
    [threadAId]: buildThreadMessages(threadAId, "Thread A", 40),
    [threadBId]: buildThreadMessages(threadBId, "Thread B", 40),
    [projectThreadId]: buildThreadMessages(projectThreadId, "Project Thread", 12),
  };

  const reviewItemId = cuid();
  const reviewResolvedItemId = cuid();
  const malformedReviewItemId = cuid();
  const processedItemId = cuid();
  const archivedItemId = cuid();
  const savedItemId = cuid();
  const processingItemId = cuid();

  const inboxItems: MockInboxItem[] = [
    {
      id: reviewItemId,
      userId: user.id,
      content: "Review this inbox entry and decide on proposals.",
      state: "REVIEW",
      processedAt: null,
      archivedAt: null,
      processingStartedAt: iso(nowMinus(15)),
      processingError: null,
      createdAt: iso(nowMinus(15)),
      updatedAt: iso(nowMinus(15)),
    },
    {
      id: reviewResolvedItemId,
      userId: user.id,
      content: "Review item with all outputs already resolved.",
      state: "REVIEW",
      processedAt: null,
      archivedAt: null,
      processingStartedAt: iso(nowMinus(30)),
      processingError: null,
      createdAt: iso(nowMinus(30)),
      updatedAt: iso(nowMinus(30)),
    },
    {
      id: malformedReviewItemId,
      userId: user.id,
      content: "Review item with malformed todo payload.",
      state: "REVIEW",
      processedAt: null,
      archivedAt: null,
      processingStartedAt: iso(nowMinus(45)),
      processingError: null,
      createdAt: iso(nowMinus(45)),
      updatedAt: iso(nowMinus(45)),
    },
    {
      id: processedItemId,
      userId: user.id,
      content: "Processed item should hide resolve-all button.",
      state: "PROCESSED",
      processedAt: iso(nowMinus(120)),
      archivedAt: null,
      processingStartedAt: iso(nowMinus(150)),
      processingError: null,
      createdAt: iso(nowMinus(150)),
      updatedAt: iso(nowMinus(120)),
    },
    {
      id: savedItemId,
      userId: user.id,
      content: "Saved item waiting to be processed.",
      state: "SAVED",
      processedAt: null,
      archivedAt: null,
      processingStartedAt: null,
      processingError: null,
      createdAt: iso(nowMinus(60)),
      updatedAt: iso(nowMinus(60)),
    },
    {
      id: processingItemId,
      userId: user.id,
      content: "Processing item eligible for recover.",
      state: "PROCESSING",
      processedAt: null,
      archivedAt: null,
      processingStartedAt: iso(nowMinus(10)),
      processingError: "Agent timed out",
      createdAt: iso(nowMinus(10)),
      updatedAt: iso(nowMinus(10)),
    },
    {
      id: archivedItemId,
      userId: user.id,
      content: "Archived inbox item",
      state: "ARCHIVED",
      processedAt: iso(nowMinus(300)),
      archivedAt: iso(nowMinus(240)),
      processingStartedAt: iso(nowMinus(320)),
      processingError: null,
      createdAt: iso(nowMinus(320)),
      updatedAt: iso(nowMinus(240)),
    },
  ];

  const inboxOutputsByItem: Record<string, MockInboxOutput[]> = {
    [reviewItemId]: [
      {
        id: cuid(),
        userId: user.id,
        inboxItemId: reviewItemId,
        agentKey: "todo_list",
        outputIndex: 0,
        payloadVersion: 1,
        payload: {
          tasks: [
            {
              title: "Buy groceries",
              status: "TODO",
              priority: "MEDIUM",
              dueDate: iso(nowMinus(-720)),
              description: "Milk, eggs, vegetables",
            },
          ],
        },
        payloadPreview: "Todo proposal: Buy groceries",
        state: "PENDING",
        errorMessage: null,
        resolvedAt: null,
        createdArtifacts: null,
        createdAt: iso(nowMinus(15)),
        updatedAt: iso(nowMinus(15)),
      },
      {
        id: cuid(),
        userId: user.id,
        inboxItemId: reviewItemId,
        agentKey: "kb_note",
        outputIndex: 1,
        payloadVersion: 1,
        payload: {
          note: "Capture this in knowledge base",
        },
        payloadPreview: "Note proposal available",
        state: "FAILED",
        errorMessage: "Temporary model failure",
        resolvedAt: null,
        createdArtifacts: null,
        createdAt: iso(nowMinus(14)),
        updatedAt: iso(nowMinus(14)),
      },
    ],
    [reviewResolvedItemId]: [
      {
        id: cuid(),
        userId: user.id,
        inboxItemId: reviewResolvedItemId,
        agentKey: "todo_list",
        outputIndex: 0,
        payloadVersion: 1,
        payload: {
          tasks: [{ title: "Already resolved task" }],
        },
        payloadPreview: "Already resolved todo",
        state: "APPROVED",
        errorMessage: null,
        resolvedAt: iso(nowMinus(25)),
        createdArtifacts: [{ type: "task", id: tasks[0].id }],
        createdAt: iso(nowMinus(30)),
        updatedAt: iso(nowMinus(25)),
      },
    ],
    [malformedReviewItemId]: [
      {
        id: cuid(),
        userId: user.id,
        inboxItemId: malformedReviewItemId,
        agentKey: "todo_list",
        outputIndex: 0,
        payloadVersion: 1,
        payload: {
          tasks: [{ title: 42 }],
        },
        payloadPreview: "Fallback preview from malformed todo payload",
        state: "PENDING",
        errorMessage: null,
        resolvedAt: null,
        createdArtifacts: null,
        createdAt: iso(nowMinus(45)),
        updatedAt: iso(nowMinus(45)),
      },
    ],
    [processedItemId]: [
      {
        id: cuid(),
        userId: user.id,
        inboxItemId: processedItemId,
        agentKey: "kb_note",
        outputIndex: 0,
        payloadVersion: 1,
        payload: {},
        payloadPreview: "Processed proposal",
        state: "DECLINED",
        errorMessage: null,
        resolvedAt: iso(nowMinus(120)),
        createdArtifacts: null,
        createdAt: iso(nowMinus(120)),
        updatedAt: iso(nowMinus(120)),
      },
    ],
    [savedItemId]: [],
    [processingItemId]: [],
    [archivedItemId]: [
      {
        id: cuid(),
        userId: user.id,
        inboxItemId: archivedItemId,
        agentKey: "kb_note",
        outputIndex: 0,
        payloadVersion: 1,
        payload: {},
        payloadPreview: "Archived output",
        state: "APPROVED",
        errorMessage: null,
        resolvedAt: iso(nowMinus(250)),
        createdArtifacts: null,
        createdAt: iso(nowMinus(260)),
        updatedAt: iso(nowMinus(250)),
      },
    ],
  };

  const analyticsSummary: MockAnalyticsSummary = {
    totals: {
      totalCalls: 18,
      totalCostUsd: 0.1823,
      totalInputTokens: 12456,
      totalOutputTokens: 9467,
    },
    byModel: [
      {
        modelKey: "anthropic.claude-haiku-4-5",
        callCount: 12,
        costUsd: 0.101,
        inputTokens: 8450,
        outputTokens: 6020,
      },
      {
        modelKey: "openai.gpt-5-mini",
        callCount: 6,
        costUsd: 0.0813,
        inputTokens: 4006,
        outputTokens: 3447,
      },
    ],
    byThread: [
      {
        threadId: threadAId,
        threadName: "Thread A",
        callCount: 11,
        costUsd: 0.11,
      },
      {
        threadId: threadBId,
        threadName: "Thread B",
        callCount: 7,
        costUsd: 0.0723,
      },
    ],
    byCallType: [
      { callType: "CHAT_STREAM", callCount: 16, costUsd: 0.17 },
      { callType: "SUMMARY_CALL", callCount: 2, costUsd: 0.0123 },
    ],
  };

  const analyticsRecentCalls: MockRecentAiCall[] = [
    {
      id: cuid(),
      callType: "CHAT_STREAM",
      modelKey: "anthropic.claude-haiku-4-5",
      providerId: "anthropic",
      status: "SUCCESS",
      costUsd: 0.0123,
      totalLatencyMs: 928,
      inputTokens: 320,
      outputTokens: 228,
      requestStartAt: iso(nowMinus(5)),
      threadId: threadAId,
      threadName: "Thread A",
    },
    {
      id: cuid(),
      callType: "CHAT_STREAM",
      modelKey: "openai.gpt-5-mini",
      providerId: "openai",
      status: "SUCCESS",
      costUsd: 0.0082,
      totalLatencyMs: 740,
      inputTokens: 240,
      outputTokens: 156,
      requestStartAt: iso(nowMinus(17)),
      threadId: threadBId,
      threadName: "Thread B",
    },
  ];

  return {
    user,
    projects,
    tasks,
    notes,
    chatThreads,
    chatMessagesByThread,
    inboxItems,
    inboxOutputsByItem,
    analyticsSummary,
    analyticsRecentCalls,
  };
}

function getOrCreateSessionState(sessionId: string) {
  const existing = sessionStore.get(sessionId);
  if (existing) {
    return existing;
  }

  const defaultUser: SessionUser = {
    id: cuid(),
    name: "E2E User",
    email: DEMO_EMAIL,
  };
  const created = createSessionState(defaultUser);
  sessionStore.set(sessionId, created);
  return created;
}

function requireSessionState(request: Request): SessionState | Response {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return unauthorized();
  }

  return getOrCreateSessionState(sessionId);
}

async function readJson(request: Request) {
  return request.json().catch(() => ({}));
}

function sortByUpdatedDesc<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function findThread(state: SessionState, threadId: string) {
  return state.chatThreads.find((thread) => thread.id === threadId) ?? null;
}

function findTask(state: SessionState, taskId: string) {
  return state.tasks.find((task) => task.id === taskId) ?? null;
}

function findNote(state: SessionState, noteId: string) {
  return state.notes.find((note) => note.id === noteId) ?? null;
}

function findInboxItem(state: SessionState, itemId: string) {
  return state.inboxItems.find((item) => item.id === itemId) ?? null;
}

function findInboxOutput(state: SessionState, outputId: string) {
  for (const [itemId, outputs] of Object.entries(state.inboxOutputsByItem)) {
    const output = outputs.find((candidate) => candidate.id === outputId);
    if (output) {
      return { itemId, output };
    }
  }

  return null;
}

function updateInboxItem(state: SessionState, nextItem: MockInboxItem) {
  const index = state.inboxItems.findIndex((item) => item.id === nextItem.id);
  if (index >= 0) {
    state.inboxItems[index] = nextItem;
  }
}

function applySearchFilter<T extends { title?: string; content?: string; name?: string }>(
  items: T[],
  search: string | null,
) {
  if (!search) {
    return items;
  }

  const needle = search.toLowerCase();
  return items.filter((item) => {
    return (
      (item.title ?? "").toLowerCase().includes(needle) ||
      (item.content ?? "").toLowerCase().includes(needle) ||
      (item.name ?? "").toLowerCase().includes(needle)
    );
  });
}

function encodeSSE(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function sseResponse(events: Array<{ payload: unknown; delayMs: number }>) {
  const encoder = new TextEncoder();
  let index = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pushNext = () => {
        if (closed) {
          return;
        }

        if (index >= events.length) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Controller may already be closed by the client.
          }
          return;
        }

        const event = events[index];
        index += 1;
        try {
          controller.enqueue(encoder.encode(encodeSSE(event.payload)));
        } catch {
          closed = true;
          if (timeout) {
            clearTimeout(timeout);
            timeout = null;
          }
          return;
        }
        timeout = setTimeout(pushNext, event.delayMs);
      };

      pushNext();
    },
    cancel() {
      closed = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    const scenarios = parseScenarioFlags(request);

    if (pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    if (pathname === "/auth/get-session" && method === "GET") {
      if (!isSessionAuthenticated(request)) {
        return unauthorized();
      }

      const sessionId = getSessionId(request);
      if (!sessionId) {
        return unauthorized();
      }

      const state = getOrCreateSessionState(sessionId);
      return jsonResponse({
        data: {
          session: {
            user: {
              id: state.user.id,
              name: state.user.name,
              email: state.user.email,
            },
          },
        },
      });
    }

    if (pathname === "/auth/sign-in/email" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const email = String(payload.email ?? "");
      const password = String(payload.password ?? "");

      if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
        return jsonResponse(
          {
            message: "Invalid email or password",
          },
          401,
        );
      }

      const sessionId = `sess-${crypto.randomUUID()}`;
      const user: SessionUser = {
        id: cuid(),
        name: "E2E User",
        email: DEMO_EMAIL,
      };
      sessionStore.set(sessionId, createSessionState(user));

      return jsonResponse(
        {
          success: true,
        },
        200,
        {
          "set-cookie": `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
        },
      );
    }

    if (pathname === "/auth/sign-up/email" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const email = String(payload.email ?? "");
      const name = String(payload.name ?? "").trim() || "New User";

      if (email.endsWith("@taken.dev")) {
        return jsonResponse(
          {
            message: "Email already exists",
          },
          409,
        );
      }

      const sessionId = `sess-${crypto.randomUUID()}`;
      const user: SessionUser = {
        id: cuid(),
        name,
        email,
      };
      sessionStore.set(sessionId, createSessionState(user));

      return jsonResponse(
        {
          success: true,
        },
        200,
        {
          "set-cookie": `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
        },
      );
    }

    if (pathname === "/auth/request-password-reset" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const email = String(payload.email ?? "");

      if (email === "missing@lifeos.dev") {
        return jsonResponse(
          {
            message: "Account not found",
          },
          404,
        );
      }

      return jsonResponse({ success: true });
    }

    if (pathname === "/auth/reset-password" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const token = String(payload.token ?? "");
      const newPassword = String(payload.newPassword ?? "");

      if (token !== "valid-reset-token" || newPassword.length < 8) {
        return jsonResponse(
          {
            message: "Invalid or expired reset token",
          },
          400,
        );
      }

      return jsonResponse({ success: true });
    }

    if (pathname === "/auth/sign-out" && method === "POST") {
      return jsonResponse(
        {
          success: true,
        },
        200,
        {
          "set-cookie": `${SESSION_COOKIE}=${INVALID_SESSION}; Path=/; HttpOnly; SameSite=Lax`,
        },
      );
    }

    if (pathname === "/auth/update-user" && method === "POST") {
      const session = requireSessionState(request);
      if (session instanceof Response) {
        return session;
      }

      const payload = (await readJson(request)) as Record<string, unknown>;
      const name = String(payload.name ?? "").trim();

      if (!name) {
        return jsonResponse({ message: "Name is required" }, 400);
      }

      if (hasScenario(scenarios, "account-update-error") || name.includes("Error")) {
        return jsonResponse({ message: "Profile update failed" }, 500);
      }

      session.user.name = name;
      return jsonResponse({
        success: true,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        },
      });
    }

    if (pathname === "/auth/change-password" && method === "POST") {
      const session = requireSessionState(request);
      if (session instanceof Response) {
        return session;
      }

      const payload = (await readJson(request)) as Record<string, unknown>;
      const currentPassword = String(payload.currentPassword ?? "");
      const newPassword = String(payload.newPassword ?? "");

      if (hasScenario(scenarios, "password-change-error")) {
        return jsonResponse({ message: "Unable to change password right now" }, 500);
      }

      if (currentPassword !== DEMO_PASSWORD) {
        return jsonResponse({ message: "Current password is incorrect" }, 400);
      }

      if (newPassword.length < 8) {
        return jsonResponse({ message: "Password must be at least 8 characters" }, 400);
      }

      return jsonResponse({ success: true });
    }

    const session = requireSessionState(request);
    if (session instanceof Response) {
      return session;
    }

    if (pathname === "/home/recent-projects" && method === "GET") {
      if (hasScenario(scenarios, "home-empty")) {
        return jsonResponse([]);
      }

      const recentProjects = sortByUpdatedDesc(session.projects)
        .slice(0, 3)
        .map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          updatedAt: project.updatedAt,
          _count: {
            tasks: session.tasks.filter(
              (task) => task.projectId === project.id && task.deletedAt === null,
            ).length,
          },
        }));

      return jsonResponse(recentProjects);
    }

    if (pathname === "/home/upcoming-tasks" && method === "GET") {
      if (hasScenario(scenarios, "home-empty")) {
        return jsonResponse([]);
      }

      const upcomingTasks = session.tasks
        .filter((task) => task.deletedAt === null)
        .slice(0, 4)
        .map((task) => {
          const project = task.projectId
            ? session.projects.find((candidate) => candidate.id === task.projectId) ?? null
            : null;
          return {
            id: task.id,
            title: task.title,
            dueDate: task.dueDate,
            priority: task.priority,
            project: project ? { name: project.name } : null,
          };
        });

      return jsonResponse(upcomingTasks);
    }

    if (pathname === "/home/recent-notes" && method === "GET") {
      if (hasScenario(scenarios, "home-empty")) {
        return jsonResponse([]);
      }

      const recentNotes = sortByUpdatedDesc(session.notes)
        .filter((note) => note.deletedAt === null)
        .slice(0, 4)
        .map((note) => ({
          id: note.id,
          title: note.title,
          content: note.content,
          updatedAt: note.updatedAt,
        }));

      return jsonResponse(recentNotes);
    }

    if (pathname === "/projects" && method === "GET") {
      const search = url.searchParams.get("search");
      const includeArchived = url.searchParams.get("includeArchived") === "true";

      const filtered = applySearchFilter(
        session.projects.filter((project) => includeArchived || !project.archivedAt),
        search,
      );

      return jsonResponse(sortByUpdatedDesc(filtered).map(toPublicProject));
    }

    if (pathname === "/projects" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const name = String(payload.name ?? "").trim();

      if (!name) {
        return jsonResponse({ message: "Name is required" }, 400);
      }

      if (hasScenario(scenarios, "project-create-error") || name.includes("Fail")) {
        return jsonResponse({ message: "Project creation failed" }, 500);
      }

      const createdAt = iso(new Date());
      const project: MockProject = {
        id: cuid(),
        userId: session.user.id,
        name,
        description: typeof payload.description === "string" ? payload.description : null,
        aiInstructions:
          typeof payload.aiInstructions === "string" ? payload.aiInstructions : null,
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
      };

      session.projects.unshift(project);
      return jsonResponse(project, 201);
    }

    const projectItemsMatch = pathname.match(/^\/projects\/([^/]+)\/items$/);
    if (projectItemsMatch && method === "GET") {
      const projectId = projectItemsMatch[1];
      const project = session.projects.find((candidate) => candidate.id === projectId);

      if (!project) {
        return jsonResponse({ message: "Project not found" }, 404);
      }

      const tasks = session.tasks.filter(
        (task) => task.projectId === projectId && task.deletedAt === null,
      );
      const notes = session.notes.filter(
        (note) => note.projectId === projectId && note.deletedAt === null,
      );
      const chatThreads = session.chatThreads.filter(
        (thread) => thread.projectId === projectId && thread.archivedAt === null,
      );

      return jsonResponse({
        ...project,
        tasks,
        notes,
        chatThreads,
      });
    }

    const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
    if (projectMatch && method === "GET") {
      const project = session.projects.find((candidate) => candidate.id === projectMatch[1]);
      if (!project) {
        return jsonResponse({ message: "Project not found" }, 404);
      }
      return jsonResponse(project);
    }

    if (projectMatch && method === "PATCH") {
      const projectId = projectMatch[1];
      const project = session.projects.find((candidate) => candidate.id === projectId);

      if (!project) {
        return jsonResponse({ message: "Project not found" }, 404);
      }

      const payload = (await readJson(request)) as Record<string, unknown>;
      const nextName =
        typeof payload.name === "string" ? payload.name.trim() : project.name;

      if (!nextName) {
        return jsonResponse({ message: "Name is required" }, 400);
      }

      if (hasScenario(scenarios, "project-update-error") || nextName.includes("Fail")) {
        return jsonResponse({ message: "Project update failed" }, 500);
      }

      const updated: MockProject = {
        ...project,
        name: nextName,
        description:
          typeof payload.description === "string"
            ? payload.description
            : project.description,
        aiInstructions:
          typeof payload.aiInstructions === "string"
            ? payload.aiInstructions
            : project.aiInstructions,
        updatedAt: iso(new Date()),
      };

      const index = session.projects.findIndex((candidate) => candidate.id === project.id);
      session.projects[index] = updated;
      return jsonResponse(updated);
    }

    if (pathname === "/tasks" && method === "GET") {
      const search = url.searchParams.get("search");
      const status = url.searchParams.get("status");
      const projectId = url.searchParams.get("projectId");

      let tasks = session.tasks.filter((task) => task.deletedAt === null);

      if (status) {
        tasks = tasks.filter((task) => task.status === status);
      }

      if (projectId) {
        tasks = tasks.filter((task) => task.projectId === projectId);
      }

      tasks = applySearchFilter(tasks, search);

      return jsonResponse(sortByUpdatedDesc(tasks).map((task) => toPublicTask(task, session)));
    }

    if (pathname === "/tasks" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const title = String(payload.title ?? "").trim();

      if (!title) {
        return jsonResponse({ message: "Title is required" }, 400);
      }

      const createdAt = iso(new Date());
      const task: MockTask = {
        id: cuid(),
        userId: session.user.id,
        title,
        description: typeof payload.description === "string" ? payload.description : null,
        status:
          payload.status === "TODO" || payload.status === "IN_PROGRESS" || payload.status === "DONE"
            ? payload.status
            : "TODO",
        priority:
          payload.priority === "LOW" || payload.priority === "MEDIUM" || payload.priority === "HIGH"
            ? payload.priority
            : "MEDIUM",
        dueDate: parseDateFromInput(payload.dueDate),
        deletedAt: null,
        projectId: typeof payload.projectId === "string" ? payload.projectId : null,
        createdAt,
        updatedAt: createdAt,
      };

      session.tasks.unshift(task);
      return jsonResponse(task, 201);
    }

    if (pathname === "/tasks/archived" && method === "GET") {
      const archived = session.tasks.filter((task) => task.deletedAt !== null);
      return jsonResponse(sortByUpdatedDesc(archived).map((task) => toPublicTask(task, session)));
    }

    const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/);
    if (taskMatch && method === "PATCH") {
      const task = findTask(session, taskMatch[1]);
      if (!task) {
        return jsonResponse({ message: "Task not found" }, 404);
      }

      const payload = (await readJson(request)) as Record<string, unknown>;
      const nextStatus =
        payload.status === "TODO" || payload.status === "IN_PROGRESS" || payload.status === "DONE"
          ? payload.status
          : task.status;

      if (
        hasScenario(scenarios, "task-move-error") &&
        payload.status !== undefined &&
        nextStatus !== task.status
      ) {
        return jsonResponse({ message: "Task move failed" }, 500);
      }

      const updated: MockTask = {
        ...task,
        title: typeof payload.title === "string" ? payload.title : task.title,
        description:
          typeof payload.description === "string"
            ? payload.description
            : payload.description === null
              ? null
              : task.description,
        status: nextStatus,
        priority:
          payload.priority === "LOW" || payload.priority === "MEDIUM" || payload.priority === "HIGH"
            ? payload.priority
            : task.priority,
        dueDate:
          payload.dueDate !== undefined
            ? parseDateFromInput(payload.dueDate)
            : task.dueDate,
        updatedAt: iso(new Date()),
      };

      const index = session.tasks.findIndex((candidate) => candidate.id === task.id);
      session.tasks[index] = updated;

      return jsonResponse(updated);
    }

    if (taskMatch && method === "DELETE") {
      const task = findTask(session, taskMatch[1]);
      if (!task) {
        return jsonResponse({ message: "Task not found" }, 404);
      }

      const updated: MockTask = {
        ...task,
        deletedAt: iso(new Date()),
        updatedAt: iso(new Date()),
      };
      const index = session.tasks.findIndex((candidate) => candidate.id === task.id);
      session.tasks[index] = updated;

      return jsonResponse({ success: true });
    }

    if (pathname === "/notes" && method === "GET") {
      const search = url.searchParams.get("search");
      const projectId = url.searchParams.get("projectId");

      let notes = session.notes.filter((note) => note.deletedAt === null);
      if (projectId) {
        notes = notes.filter((note) => note.projectId === projectId);
      }

      notes = applySearchFilter(notes, search);

      return jsonResponse(sortByUpdatedDesc(notes).map((note) => toPublicNote(note, session)));
    }

    if (pathname === "/notes" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const title = String(payload.title ?? "").trim() || "Untitled note";
      const content = typeof payload.content === "string" ? payload.content : "";
      const createdAt = iso(new Date());

      const note: MockNote = {
        id: cuid(),
        userId: session.user.id,
        title,
        content,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        projectId: typeof payload.projectId === "string" ? payload.projectId : null,
        sourceMessageId: null,
      };

      session.notes.unshift(note);
      return jsonResponse(note, 201);
    }

    if (pathname === "/notes/save-from-message" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const messageId = String(payload.messageId ?? "");

      let message: MockChatMessage | null = null;
      let thread: MockChatThread | null = null;
      for (const threadCandidate of session.chatThreads) {
        const messages = session.chatMessagesByThread[threadCandidate.id] ?? [];
        const found = messages.find((candidate) => candidate.id === messageId);
        if (found) {
          message = found;
          thread = threadCandidate;
          break;
        }
      }

      if (!message) {
        return jsonResponse({ message: "Message not found" }, 404);
      }

      if (message.savedNoteId) {
        const existingNote = session.notes.find((note) => note.id === message.savedNoteId);
        if (!existingNote) {
          return jsonResponse({ message: "Saved note not found" }, 404);
        }

        return jsonResponse({
          note: existingNote,
          alreadySaved: true,
        });
      }

      const createdAt = iso(new Date());
      const note: MockNote = {
        id: cuid(),
        userId: session.user.id,
        title: message.content.slice(0, 40) || "Saved message",
        content: message.content,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        projectId: thread?.projectId ?? null,
        sourceMessageId: message.id,
      };
      session.notes.unshift(note);

      const threadMessages = session.chatMessagesByThread[message.threadId] ?? [];
      const messageIndex = threadMessages.findIndex((candidate) => candidate.id === message.id);
      if (messageIndex >= 0) {
        threadMessages[messageIndex] = {
          ...threadMessages[messageIndex],
          savedNoteId: note.id,
        };
      }

      return jsonResponse({
        note,
        alreadySaved: false,
      });
    }

    const noteMatch = pathname.match(/^\/notes\/([^/]+)$/);
    if (noteMatch && method === "GET") {
      const note = findNote(session, noteMatch[1]);
      if (!note || note.deletedAt !== null) {
        return jsonResponse({ message: "Note not found" }, 404);
      }
      return jsonResponse(note);
    }

    if (noteMatch && method === "PATCH") {
      const note = findNote(session, noteMatch[1]);
      if (!note || note.deletedAt !== null) {
        return jsonResponse({ message: "Note not found" }, 404);
      }

      const payload = (await readJson(request)) as Record<string, unknown>;
      const updated: MockNote = {
        ...note,
        title: typeof payload.title === "string" ? payload.title : note.title,
        content: typeof payload.content === "string" ? payload.content : note.content,
        updatedAt: iso(new Date()),
      };

      const index = session.notes.findIndex((candidate) => candidate.id === note.id);
      session.notes[index] = updated;
      return jsonResponse(updated);
    }

    if (noteMatch && method === "DELETE") {
      const note = findNote(session, noteMatch[1]);
      if (!note || note.deletedAt !== null) {
        return jsonResponse({ message: "Note not found" }, 404);
      }

      const index = session.notes.findIndex((candidate) => candidate.id === note.id);
      session.notes[index] = {
        ...note,
        deletedAt: iso(new Date()),
        updatedAt: iso(new Date()),
      };

      return jsonResponse({ success: true });
    }

    if (pathname === "/chat/models" && method === "GET") {
      return jsonResponse([
        {
          key: "openai.gpt-5-mini",
          label: "OpenAI GPT-5 Mini",
          provider: "openai",
          costTier: "economy",
          description: "Fast model for everyday chat.",
          supportsStreaming: true,
        },
        {
          key: "anthropic.claude-haiku-4-5",
          label: "Anthropic Claude Haiku 4.5",
          provider: "anthropic",
          costTier: "economy",
          description: "Lightweight Claude option.",
          supportsStreaming: true,
        },
      ]);
    }

    if (pathname === "/chat/threads" && method === "GET") {
      const includeArchived = url.searchParams.get("includeArchived") === "true";
      const projectId = url.searchParams.get("projectId");

      let threads = session.chatThreads.filter(
        (thread) => includeArchived || thread.archivedAt === null,
      );

      if (projectId) {
        threads = threads.filter((thread) => thread.projectId === projectId);
      }

      const sorted = [...threads].sort(
        (a, b) => new Date(b.lastChattedAt).getTime() - new Date(a.lastChattedAt).getTime(),
      );

      return jsonResponse(sorted.map((thread) => toPublicThread(thread, session)));
    }

    if (pathname === "/chat/threads" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const nowIso = iso(new Date());
      const thread: MockChatThread = {
        id: cuid(),
        userId: session.user.id,
        name: typeof payload.name === "string" && payload.name.trim().length > 0
          ? payload.name
          : `New thread (${session.chatThreads.length + 1})`,
        modelKey: null,
        summary: null,
        summaryUpTo: null,
        lastChattedAt: nowIso,
        archivedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        projectId: typeof payload.projectId === "string" ? payload.projectId : null,
      };

      session.chatThreads.unshift(thread);
      session.chatMessagesByThread[thread.id] = [];
      return jsonResponse(thread, 201);
    }

    const threadArchiveMatch = pathname.match(/^\/chat\/threads\/([^/]+)\/archive$/);
    if (threadArchiveMatch && method === "POST") {
      const thread = findThread(session, threadArchiveMatch[1]);
      if (!thread) {
        return jsonResponse({ message: "Thread not found" }, 404);
      }

      const updated: MockChatThread = {
        ...thread,
        archivedAt: iso(new Date()),
        updatedAt: iso(new Date()),
      };
      const index = session.chatThreads.findIndex((candidate) => candidate.id === thread.id);
      session.chatThreads[index] = updated;
      return jsonResponse(updated);
    }

    const threadMatch = pathname.match(/^\/chat\/threads\/([^/]+)$/);
    if (threadMatch && method === "GET") {
      const thread = findThread(session, threadMatch[1]);
      if (!thread) {
        return jsonResponse({ message: "Thread not found" }, 404);
      }
      return jsonResponse(toPublicThread(thread, session));
    }

    const threadMessagesMatch = pathname.match(/^\/chat\/threads\/([^/]+)\/messages$/);
    if (threadMessagesMatch && method === "GET") {
      const threadId = threadMessagesMatch[1];
      const messages = session.chatMessagesByThread[threadId];
      if (!messages) {
        return jsonResponse({ message: "Thread not found" }, 404);
      }

      const limit = Number(url.searchParams.get("limit") ?? "30");
      const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 30;
      const cursorId = url.searchParams.get("cursorId");

      const sortedMessages = [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      let pageMessages: MockChatMessage[] = [];
      let nextCursor: { id: string; createdAt: string } | null = null;

      if (!cursorId) {
        pageMessages = sortedMessages.slice(-safeLimit);
        if (sortedMessages.length > safeLimit && pageMessages[0]) {
          nextCursor = {
            id: pageMessages[0].id,
            createdAt: pageMessages[0].createdAt,
          };
        }
      } else {
        const cursorIndex = sortedMessages.findIndex((message) => message.id === cursorId);
        const olderMessages = cursorIndex >= 0 ? sortedMessages.slice(0, cursorIndex) : [];
        pageMessages = olderMessages.slice(-safeLimit);
        if (olderMessages.length > safeLimit && pageMessages[0]) {
          nextCursor = {
            id: pageMessages[0].id,
            createdAt: pageMessages[0].createdAt,
          };
        }
      }

      return jsonResponse({
        threadId,
        messages: pageMessages,
        nextCursor,
      });
    }

    const modelMatch = pathname.match(/^\/chat\/threads\/([^/]+)\/model$/);
    if (modelMatch && method === "POST") {
      const thread = findThread(session, modelMatch[1]);
      if (!thread) {
        return jsonResponse({ message: "Thread not found" }, 404);
      }

      const payload = (await readJson(request)) as Record<string, unknown>;
      const modelKey =
        typeof payload.modelKey === "string" ? payload.modelKey : payload.modelKey === null ? null : thread.modelKey;

      if (modelKey === "openai.gpt-5-mini") {
        return jsonResponse({ message: "Model selection is unavailable right now" }, 400);
      }

      const updated: MockChatThread = {
        ...thread,
        modelKey,
        updatedAt: iso(new Date()),
      };
      const index = session.chatThreads.findIndex((candidate) => candidate.id === thread.id);
      session.chatThreads[index] = updated;

      return jsonResponse(updated);
    }

    if (pathname === "/chat/stream" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const threadId = String(payload.threadId ?? "");
      const content =
        typeof payload.content === "string" && payload.content.trim().length > 0
          ? payload.content.trim()
          : null;
      const regenerateFromMessageId =
        typeof payload.regenerateFromMessageId === "string"
          ? payload.regenerateFromMessageId
          : null;

      const thread = findThread(session, threadId);
      if (!thread) {
        return jsonResponse({ message: "Thread not found" }, 404);
      }

      const threadMessages = session.chatMessagesByThread[threadId] ?? [];
      const shouldError = hasScenario(scenarios, "stream-error") || content?.includes("[stream-error]");
      const isSlow = hasScenario(scenarios, "stream-slow");

      if (content) {
        const userMessage: MockChatMessage = {
          id: cuid(),
          threadId,
          role: "USER",
          content,
          createdAt: iso(new Date()),
          modelKey: null,
          modelLabel: null,
          modelProvider: null,
          tokenCount: null,
          tokenCountSource: null,
          savedNoteId: null,
        };
        threadMessages.push(userMessage);
      }

      if (shouldError) {
        const errorEvents = [
          {
            payload: { type: "chunk", text: "Streaming started... " },
            delayMs: isSlow ? 240 : 30,
          },
          {
            payload: { type: "error", error: "Mock stream failure" },
            delayMs: isSlow ? 240 : 30,
          },
          {
            payload: { type: "done" },
            delayMs: 10,
          },
        ];

        return sseResponse(errorEvents);
      }

      const assistantText = regenerateFromMessageId
        ? "Regenerated response based on the latest assistant message."
        : `Mock assistant response for: ${content ?? "(empty)"}`;
      const assistantMessageId = cuid();
      const createdAt = new Date();

      const assistantMessage: MockChatMessage = {
        id: assistantMessageId,
        threadId,
        role: "ASSISTANT",
        content: assistantText,
        createdAt: iso(createdAt),
        modelKey: "anthropic.claude-haiku-4-5",
        modelLabel: "Anthropic Claude Haiku 4.5",
        modelProvider: "anthropic",
        tokenCount: 64,
        tokenCountSource: "ESTIMATE",
        savedNoteId: null,
      };
      threadMessages.push(assistantMessage);
      session.chatMessagesByThread[threadId] = threadMessages;

      const threadIndex = session.chatThreads.findIndex((candidate) => candidate.id === threadId);
      if (threadIndex >= 0) {
        session.chatThreads[threadIndex] = {
          ...session.chatThreads[threadIndex],
          lastChattedAt: iso(createdAt),
          updatedAt: iso(createdAt),
        };
      }

      const chunks = assistantText.match(/.{1,20}/g) ?? [assistantText];
      const successEvents: Array<{ payload: unknown; delayMs: number }> = chunks.map((chunk) => ({
        payload: { type: "chunk", text: chunk },
        delayMs: isSlow ? 160 : 20,
      }));
      successEvents.push({
        payload: { type: "message_saved", messageId: assistantMessageId },
        delayMs: 20,
      });
      successEvents.push({
        payload: { type: "done" },
        delayMs: 10,
      });

      return sseResponse(successEvents);
    }

    if (pathname === "/inbox" && method === "GET") {
      const search = url.searchParams.get("search");
      const stateFilter = url.searchParams.get("state");

      let items = session.inboxItems.filter((item) => item.state !== "ARCHIVED");
      if (stateFilter) {
        items = items.filter((item) => item.state === stateFilter);
      }

      items = applySearchFilter(items, search);

      return jsonResponse(
        [...items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
    }

    if (pathname === "/inbox" && method === "POST") {
      const payload = (await readJson(request)) as Record<string, unknown>;
      const content = String(payload.content ?? "").trim();
      if (!content) {
        return jsonResponse({ message: "Content is required" }, 400);
      }

      const createdAt = iso(new Date());
      const item: MockInboxItem = {
        id: cuid(),
        userId: session.user.id,
        content,
        state: "SAVED",
        processedAt: null,
        archivedAt: null,
        processingStartedAt: null,
        processingError: null,
        createdAt,
        updatedAt: createdAt,
      };

      session.inboxItems.unshift(item);
      session.inboxOutputsByItem[item.id] = [];

      return jsonResponse(item, 201);
    }

    if (pathname === "/inbox/archived" && method === "GET") {
      const search = url.searchParams.get("search");
      const items = applySearchFilter(
        session.inboxItems.filter((item) => item.state === "ARCHIVED"),
        search,
      );

      return jsonResponse(
        [...items].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
      );
    }

    const inboxOutputsMatch = pathname.match(/^\/inbox\/([^/]+)\/outputs$/);
    if (inboxOutputsMatch && method === "GET") {
      const itemId = inboxOutputsMatch[1];
      if (!findInboxItem(session, itemId)) {
        return jsonResponse({ message: "Inbox item not found" }, 404);
      }

      const outputs = session.inboxOutputsByItem[itemId] ?? [];
      return jsonResponse(outputs);
    }

    const inboxProcessMatch = pathname.match(/^\/inbox\/([^/]+)\/process$/);
    if (inboxProcessMatch && method === "POST") {
      const item = findInboxItem(session, inboxProcessMatch[1]);
      if (!item) {
        return jsonResponse({ message: "Inbox item not found" }, 404);
      }

      const nowIso = iso(new Date());
      const updated: MockInboxItem = {
        ...item,
        state: "PROCESSED",
        processedAt: nowIso,
        updatedAt: nowIso,
      };
      updateInboxItem(session, updated);

      const outputs = session.inboxOutputsByItem[item.id] ?? [];
      session.inboxOutputsByItem[item.id] = outputs.map((output) => {
        if (output.state === "PENDING" || output.state === "FAILED") {
          return {
            ...output,
            state: "DECLINED",
            resolvedAt: nowIso,
            updatedAt: nowIso,
            errorMessage: null,
          };
        }

        return output;
      });

      return jsonResponse(updated);
    }

    const inboxRecoverMatch = pathname.match(/^\/inbox\/([^/]+)\/recover$/);
    if (inboxRecoverMatch && method === "POST") {
      const item = findInboxItem(session, inboxRecoverMatch[1]);
      if (!item) {
        return jsonResponse({ message: "Inbox item not found" }, 404);
      }

      const nowIso = iso(new Date());
      const updated: MockInboxItem = {
        ...item,
        state: "REVIEW",
        processingError: null,
        updatedAt: nowIso,
      };
      updateInboxItem(session, updated);
      return jsonResponse(updated);
    }

    const inboxArchiveMatch = pathname.match(/^\/inbox\/([^/]+)\/archive$/);
    if (inboxArchiveMatch && method === "POST") {
      const item = findInboxItem(session, inboxArchiveMatch[1]);
      if (!item) {
        return jsonResponse({ message: "Inbox item not found" }, 404);
      }

      const nowIso = iso(new Date());
      const updated: MockInboxItem = {
        ...item,
        state: "ARCHIVED",
        archivedAt: nowIso,
        updatedAt: nowIso,
      };
      updateInboxItem(session, updated);
      return jsonResponse(updated);
    }

    const inboxUnarchiveMatch = pathname.match(/^\/inbox\/([^/]+)\/unarchive$/);
    if (inboxUnarchiveMatch && method === "POST") {
      const item = findInboxItem(session, inboxUnarchiveMatch[1]);
      if (!item) {
        return jsonResponse({ message: "Inbox item not found" }, 404);
      }

      const nowIso = iso(new Date());
      const updated: MockInboxItem = {
        ...item,
        state: "REVIEW",
        archivedAt: null,
        updatedAt: nowIso,
      };
      updateInboxItem(session, updated);
      return jsonResponse(updated);
    }

    const inboxBulkResolveMatch = pathname.match(/^\/inbox\/([^/]+)\/outputs\/(approve-all|decline-all)$/);
    if (inboxBulkResolveMatch && method === "POST") {
      const itemId = inboxBulkResolveMatch[1];
      const mode = inboxBulkResolveMatch[2];
      const item = findInboxItem(session, itemId);
      if (!item) {
        return jsonResponse({ message: "Inbox item not found" }, 404);
      }

      const nowIso = iso(new Date());
      const outputs = session.inboxOutputsByItem[itemId] ?? [];
      const results: Array<{
        outputId: string;
        state: "updated" | "unchanged" | "failed";
        output: MockInboxOutput;
        error?: string;
      }> = [];

      session.inboxOutputsByItem[itemId] = outputs.map((output) => {
        if (output.state !== "PENDING" && output.state !== "FAILED") {
          results.push({
            outputId: output.id,
            state: "unchanged",
            output,
          });
          return output;
        }

        const nextState = mode === "approve-all" ? "APPROVED" : "DECLINED";
        const updatedOutput: MockInboxOutput = {
          ...output,
          state: nextState,
          resolvedAt: nowIso,
          errorMessage: null,
          updatedAt: nowIso,
        };

        results.push({
          outputId: output.id,
          state: "updated",
          output: updatedOutput,
        });

        return updatedOutput;
      });

      const updatedItem: MockInboxItem = {
        ...item,
        updatedAt: nowIso,
      };
      updateInboxItem(session, updatedItem);

      return jsonResponse({
        itemId,
        inboxItem: updatedItem,
        results,
      });
    }

    const outputActionMatch = pathname.match(
      /^\/inbox\/outputs\/([^/]+)\/(approve|decline|retry|skip)$/,
    );
    if (outputActionMatch && method === "POST") {
      const outputId = outputActionMatch[1];
      const action = outputActionMatch[2];

      const found = findInboxOutput(session, outputId);
      if (!found) {
        return jsonResponse({ message: "Output not found" }, 404);
      }

      const nowIso = iso(new Date());
      const outputs = session.inboxOutputsByItem[found.itemId] ?? [];
      let updatedOutput: MockInboxOutput | null = null;

      session.inboxOutputsByItem[found.itemId] = outputs.map((output) => {
        if (output.id !== outputId) {
          return output;
        }

        if (action === "retry") {
          updatedOutput = {
            ...output,
            state: "PENDING",
            errorMessage: null,
            resolvedAt: null,
            updatedAt: nowIso,
          };
          return updatedOutput;
        }

        const nextStateByAction = {
          approve: "APPROVED",
          decline: "DECLINED",
          skip: "SKIPPED",
        } as const;

        updatedOutput = {
          ...output,
          state: nextStateByAction[action as "approve" | "decline" | "skip"],
          errorMessage: null,
          resolvedAt: nowIso,
          updatedAt: nowIso,
        };
        return updatedOutput;
      });

      if (!updatedOutput) {
        return jsonResponse({ message: "Output not found" }, 404);
      }

      const item = findInboxItem(session, found.itemId);
      if (!item) {
        return jsonResponse({ message: "Inbox item not found" }, 404);
      }

      const updatedItem: MockInboxItem = {
        ...item,
        updatedAt: nowIso,
      };
      updateInboxItem(session, updatedItem);

      return jsonResponse({
        output: updatedOutput,
        inboxItem: updatedItem,
      });
    }

    if (pathname === "/analytics/dashboard" && method === "GET") {
      if (hasScenario(scenarios, "analytics-empty")) {
        return jsonResponse({
          summary: {
            totals: {
              totalCalls: 0,
              totalCostUsd: 0,
              totalInputTokens: 0,
              totalOutputTokens: 0,
            },
            byModel: [],
            byThread: [],
            byCallType: [],
          },
          recentCalls: [],
        });
      }

      return jsonResponse({
        summary: session.analyticsSummary,
        recentCalls: session.analyticsRecentCalls,
      });
    }

    return jsonResponse(
      {
        error: "not_found",
        message: `No mock route for ${method} ${pathname}`,
      },
      404,
    );
  },
});

console.log(`Mock API listening on http://127.0.0.1:${server.port}`);
